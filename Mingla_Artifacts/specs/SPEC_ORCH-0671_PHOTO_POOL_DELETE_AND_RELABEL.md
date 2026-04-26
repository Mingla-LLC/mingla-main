# SPEC — ORCH-0671: Delete standalone Photo Pool admin page + relabel Photos tab on Place Pool page

**Status:** BINDING CONTRACT (post-orchestrator review = ready for implementor)
**Investigation:** [reports/INVESTIGATION_ORCH-0671_PHOTO_TAB_BOUNCER_AWARENESS.md](Mingla_Artifacts/reports/INVESTIGATION_ORCH-0671_PHOTO_TAB_BOUNCER_AWARENESS.md)
**Dispatch:** [prompts/SPEC_ORCH-0671_PHOTO_POOL_DELETE_AND_RELABEL.md](Mingla_Artifacts/prompts/SPEC_ORCH-0671_PHOTO_POOL_DELETE_AND_RELABEL.md)
**Strategic gate Q-671-1:** locked Option C (DELETE) by founder 2026-04-25
**Spec writer:** mingla-forensics SPEC mode
**Date:** 2026-04-25

---

## §0 — Investigation Ingest Confirmation

I have read the full investigation. Both founder claims are PROVEN HIGH with file:line + live-DB SQL evidence. I confirm understanding of:

- **Surface A** (Photos tab on Place Pool page) is bouncer-aware in behavior (calls `backfill-place-photos` edge fn modes `'initial'`/`'refresh_servable'`, both gate `is_servable=true`); only labels are stale.
- **Surface B** (standalone Photos page at route `photos`) is bouncer-blind across all 5 page-only RPCs and its trigger button has no consumer (17 zombie pending rows since 2026-04-02).
- $695.63/mo phantom cost vs. $0 real — Constitution #9 violation.
- Constitution #2 violation: two parallel backfill systems (`admin_trigger_backfill`+`admin_backfill_log` no consumer; `backfill-place-photos`+`photo_backfill_runs` works).
- D-3 (broken MV) was a FALSE ALARM, verified live via `pg_matviews`.

**§0 pre-flight verification (5 steps from dispatch) — ALL PASS:**

| Step | Result |
|------|--------|
| §0.1 callers of 9 to-drop RPCs | Only `mingla-admin/src/pages/PhotoPoolManagementPage.jsx` + `mingla-admin/src/components/seeding/RefreshTab.jsx` (the latter calls only `admin_pool_stats_overview`, handled in scope per Q-671-2). |
| §0.2 callers of 3 conditional-drop RPCs (`admin_backfill_log_list`, `admin_backfill_status`, `admin_backfill_weekly_costs`) | Only `mingla-admin/src/pages/PhotoPoolManagementPage.jsx`. → Safe to drop all three. |
| §0.3 `admin_backfill_log` consumer | `supabase/functions/admin-refresh-places/index.ts` consumes `operation_type='place_refresh'`. → Table + that one operation_type value MUST stay. |
| §0.4 `admin_place_pool_mv` health | `has_dropped_col=false`, `has_servable_col=true`, `row_count=65,377`. Healthy. |
| §0.5 zombie row breakdown | photo_backfill: 4 completed ($84.88, 11,959 API calls, March 18-19 2026), 2 failed ($0.70, 48 API calls, March 18 2026), 17 pending ($3,283.98 *estimated* — never actually spent because no consumer, April 2 2026). category_fill: 0 rows ever. |

**Live RPC signature manifest (from `pg_get_function_identity_arguments` 2026-04-25):**

```
admin_backfill_log_list(p_limit integer, p_offset integer)            → jsonb
admin_backfill_status(p_backfill_log_id uuid)                         → jsonb
admin_backfill_weekly_costs()                                         → jsonb
admin_photo_pool_categories()                                         → jsonb
admin_photo_pool_locations()                                          → jsonb
admin_photo_pool_missing_places(p_limit integer, p_offset integer)    → jsonb
admin_photo_pool_refresh_health()                                     → jsonb
admin_photo_pool_summary()                                            → jsonb
admin_pool_category_detail(p_category text)                           → jsonb
admin_trigger_backfill(p_mode text, p_place_pool_ids uuid[])          → jsonb
admin_trigger_category_fill(
  p_category text, p_lat double precision, p_lng double precision,
  p_radius_m integer, p_max_results integer)                          → jsonb
```

**One key live-DB finding:** `admin_pool_stats_overview` does **NOT exist in the live database** (not returned by the manifest query). Likely already dropped at some point but never deleted from the migration source. Migration must use `DROP FUNCTION IF EXISTS` — idempotent regardless. RefreshTab's call at [:104](mingla-admin/src/components/seeding/RefreshTab.jsx#L104) is therefore failing today with `PGRST202` and being silently swallowed by the catch block — Constitution #3 violation already in production.

---

## §1 — Architectural Decisions Locked

### DEC-671 — Orphan log row disposition

**Decision: HYBRID (archive 4 completed; delete the rest).**

| Bucket | Disposition | Rationale |
|--------|-------------|-----------|
| 4 completed runs (March 18-19, $84.88 spend, 11,959 API calls) | INSERT into new `admin_backfill_log_archive_orch_0671` mirror table; DELETE from main | Historical baseline of pre-bouncer photo backfill spend; cheap to keep; useful for cost-trend research later |
| 2 failed runs ($0.70, 48 API calls) | DELETE | No useful data; failure errors recorded in `error_details` JSON not worth preserving |
| 17 pending zombies (April 2, $3,283.98 estimated, $0 actual spend) | DELETE | Never executed; place_ids no longer resolve |
| 0 category_fill rows | N/A | None ever existed |

The archive table mirrors `admin_backfill_log` schema 1:1 (no constraints, no RLS, no FK), with one new column `archived_at TIMESTAMPTZ DEFAULT now()` and one new column `archive_reason TEXT NOT NULL` (set to `'ORCH-0671 photo_backfill consumer retired'`).

### Q-671-2 — RefreshTab pool-health panel fate

**Decision: DELETE the panel.**

[mingla-admin/src/components/seeding/RefreshTab.jsx](mingla-admin/src/components/seeding/RefreshTab.jsx) calls `supabase.rpc("admin_pool_stats_overview")` at [:104](mingla-admin/src/components/seeding/RefreshTab.jsx#L104) which is already failing silently (function doesn't exist in live DB). The panel was always a global stat displayed in a per-city refresh tab — conceptually misplaced. Deletion accepts the loss; if a global pool-health stat is ever wanted, it gets a new home (likely Overview page) in a separate ORCH.

Rationale: keeping it requires adding a new bouncer-aware RPC just to populate a misplaced panel. Constitution #2 (one place per concept) + Constitution #8 (subtract before adding) both argue for deletion.

### Field rename (`blockedByAiApproval` → `blockedByNotServable`)

**Decision: RENAME and ship edge fn + UI consumer in same commit (no skew window).**

Edge fn admin endpoint is admin-only; no mobile clients consume `RunPreviewAnalysis`. Skew between edge fn and UI is not worth managing for an internal admin field rename. Per HF-I (investigation §6), the UI also currently double-counts `blockedByAiApproval` + `blockedByNotServable` lines. After rename, only `blockedByNotServable` exists; the redundant line in `formatPreviewBreakdown` is removed in the same diff.

---

## §2 — Scope and Non-Goals

### In scope (this spec)

**DELETE:**
1. File: `mingla-admin/src/pages/PhotoPoolManagementPage.jsx` (1,366 lines)
2. Import + route registration: `mingla-admin/src/App.jsx` lines 17 + 40
3. Sidebar nav entry: `mingla-admin/src/lib/constants.js` line 139 (`{ id: "photos", label: "Photo Pool", icon: "Camera" }`)
4. Sidebar `Camera` lucide-react import: `mingla-admin/src/components/layout/Sidebar.jsx` line 15 + `Camera` reference in ICON_MAP at line 31 (verified: `Camera` is used by exactly one nav entry — the one being deleted)
5. Database functions (12 total — 11 live + 1 historical, all `DROP FUNCTION IF EXISTS` for idempotency):
   - `admin_photo_pool_summary()`
   - `admin_photo_pool_missing_places(integer, integer)`
   - `admin_photo_pool_categories()`
   - `admin_photo_pool_locations()`
   - `admin_photo_pool_refresh_health()`
   - `admin_pool_category_detail(text)`
   - `admin_trigger_backfill(text, uuid[])`
   - `admin_trigger_category_fill(text, double precision, double precision, integer, integer)`
   - `admin_pool_stats_overview()` (already-absent-but-defensive)
   - `admin_backfill_log_list(integer, integer)`
   - `admin_backfill_status(uuid)`
   - `admin_backfill_weekly_costs()`
6. Orphan rows in `admin_backfill_log` per DEC-671
7. CHECK constraint on `admin_backfill_log.operation_type`: shrink to `CHECK (operation_type = 'place_refresh')` (was `IN ('photo_backfill','category_fill','place_refresh')`)
8. RefreshTab `poolHealth` state, RPC call, catch block, and panel JSX

**FIX (label-only, on PlacePoolManagementPage.jsx):**
9. Line 1737: `label="Not AI Approved"` → `label="Not Bouncer Approved"`
10. Line 1394: `"X not AI-approved"` → `"X not Bouncer-approved"`
11. Lines 2069-2070: SectionCard `title="AI-Approved Places by Category"` → `title="Bouncer-Approved Places by Category"`
12. Lines 1980, 2024: comments referencing "AI-approved category breakdown" → "Bouncer-approved category breakdown"

**FIX (edge fn):**
13. `supabase/functions/backfill-place-photos/index.ts` line 173: replace `ai_approved` with `is_servable` in mode docstring
14. Same file lines 217-220: replace `ai_approved` with `is_servable` in function comment
15. Same file lines 186-187: dedupe duplicated `is_servable?: boolean | null;` declaration in `CityPlaceRow` interface
16. Same file line 197: rename `RunPreviewAnalysis.blockedByAiApproval` → `blockedByNotServable`
17. Same file lines 240-289 (`buildRunPreview`): consolidate logic so only `blockedByNotServable` is populated (was: `blockedByAiApproval` populated in `'initial'` mode, `blockedByNotServable` populated in `'refresh_servable'` mode — both count `is_servable !== true`, just in different modes); after rename, single field works for both modes

**FIX (admin UI consumer of renamed field):**
18. `mingla-admin/src/pages/PlacePoolManagementPage.jsx` line 1394: change `analysis.blockedByAiApproval` reference to `analysis.blockedByNotServable`
19. Same file line 1737: change `previewSummary.blockedByAiApproval` reference to `previewSummary.blockedByNotServable`
20. Same file lines 1391-1400 (`formatPreviewBreakdown`): remove the now-redundant duplicate line that previously rendered `blockedByNotServable` separately (HF-I cleanup)

**ADD (invariants + CI gates):**
21. INVARIANT_REGISTRY.md: add 3 new invariants per §4 below
22. scripts/ci-check-invariants.sh: add 3 new gates per §3.7 below

### Non-goals (explicit, do NOT touch in this spec)

- `app-mobile/` — admin-only spec
- `backfill-place-photos` runtime behavior (modes `'initial'` and `'refresh_servable'` keep current logic; only comments + dedupe + field rename change)
- `admin-refresh-places` edge fn — keeps consuming `place_refresh` operation_type
- `admin_backfill_log` table itself (kept; only constraint shrinks + orphan rows handled per DEC-671)
- D-2 (Bouncer Coverage tab — separate ORCH-0672 if founder wants it)
- D-4 (setup-fallback pattern audit — separate ORCH)
- D-7 (admin_trigger_category_fill modal — RESOLVED by deletion, no migration to seeding tab needed)
- New global photo-health dashboard — founder-confirmed loss; build fresh later if needed

### Assumptions

- A1: No external consumer of `admin_backfill_log` photo_backfill or category_fill rows beyond the page being deleted. (Verified §0.1, §0.3.)
- A2: `Camera` lucide-react icon is used by exactly one NAV_GROUPS entry (the one being deleted). (Verified via grep `icon.*Camera` → 1 match at constants.js:139.)
- A3: Admin route hash `#/photos` will gracefully route to default after deletion via `getTabFromHash` fallback at [App.jsx:51](mingla-admin/src/App.jsx#L51) (`PAGES[hash] ? hash : "overview"`).
- A4: Edge fn `backfill-place-photos` is admin-only (verified — invoked only from `mingla-admin/src/pages/PlacePoolManagementPage.jsx`); no mobile / external consumer to manage version skew with.

---

## §3 — Per-Layer Specification

### §3.1 Database layer

#### Migration file

**Filename:** `supabase/migrations/20260428100001_orch_0671_drop_photo_pool_admin_surface.sql`

**Wrapped in:** `BEGIN; ... COMMIT;` (single transaction; either all changes apply or none)

**Order:**

```sql
-- ORCH-0671 — Delete standalone Photo Pool admin surface.
-- Founder Q-671-1 = Option C (DELETE). Investigation:
--   Mingla_Artifacts/reports/INVESTIGATION_ORCH-0671_PHOTO_TAB_BOUNCER_AWARENESS.md
-- Spec:
--   Mingla_Artifacts/specs/SPEC_ORCH-0671_PHOTO_POOL_DELETE_AND_RELABEL.md
--
-- This migration:
--   1. Creates admin_backfill_log_archive_orch_0671 (1:1 mirror + 2 audit cols)
--   2. Archives the 4 completed photo_backfill rows ($84.88 historical baseline)
--   3. Deletes the 2 failed + 17 pending photo_backfill rows + any category_fill rows
--   4. Shrinks admin_backfill_log.operation_type CHECK to 'place_refresh' only
--   5. Drops 12 RPCs (no consumers — Constitution #8 subtract-before-add)
--
-- Idempotent: every operation uses IF [NOT] EXISTS. Safe to re-run.
-- Rollback: see 20260428100002_orch_0671_ROLLBACK.sql.

BEGIN;

-- ──────────────────────────────────────────────────────────────────────────
-- Step 1: Archive table for historical photo_backfill spend baseline (DEC-671)
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.admin_backfill_log_archive_orch_0671 (
  id                  UUID PRIMARY KEY,
  operation_type      TEXT NOT NULL,
  triggered_by        UUID,
  status              TEXT NOT NULL,
  place_ids           UUID[],
  target_category     TEXT,
  target_lat          DOUBLE PRECISION,
  target_lng          DOUBLE PRECISION,
  target_radius_m     INTEGER,
  total_places        INTEGER NOT NULL DEFAULT 0,
  success_count       INTEGER NOT NULL DEFAULT 0,
  failure_count       INTEGER NOT NULL DEFAULT 0,
  error_details       JSONB DEFAULT '[]'::jsonb,
  api_calls_made      INTEGER NOT NULL DEFAULT 0,
  estimated_cost_usd  NUMERIC(8,4) NOT NULL DEFAULT 0,
  started_at          TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ,
  updated_at          TIMESTAMPTZ,
  -- Audit columns added by ORCH-0671:
  archived_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  archive_reason      TEXT NOT NULL
);

ALTER TABLE public.admin_backfill_log_archive_orch_0671 ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_only_archive_orch_0671"
  ON public.admin_backfill_log_archive_orch_0671;
CREATE POLICY "service_role_only_archive_orch_0671"
  ON public.admin_backfill_log_archive_orch_0671
  FOR ALL USING (auth.role() = 'service_role');

COMMENT ON TABLE public.admin_backfill_log_archive_orch_0671 IS
  'ORCH-0671 archive: historical photo_backfill rows preserved when the standalone Photo Pool admin page was retired. Read-only baseline for pre-bouncer-cutover spend research. See spec at Mingla_Artifacts/specs/SPEC_ORCH-0671_PHOTO_POOL_DELETE_AND_RELABEL.md';

-- ──────────────────────────────────────────────────────────────────────────
-- Step 2: Archive the 4 completed photo_backfill rows
-- ──────────────────────────────────────────────────────────────────────────
INSERT INTO public.admin_backfill_log_archive_orch_0671 (
  id, operation_type, triggered_by, status, place_ids,
  target_category, target_lat, target_lng, target_radius_m,
  total_places, success_count, failure_count, error_details,
  api_calls_made, estimated_cost_usd,
  started_at, completed_at, created_at, updated_at,
  archive_reason
)
SELECT
  id, operation_type, triggered_by, status, place_ids,
  target_category, target_lat, target_lng, target_radius_m,
  total_places, success_count, failure_count, error_details,
  api_calls_made, estimated_cost_usd,
  started_at, completed_at, created_at, updated_at,
  'ORCH-0671 photo_backfill consumer retired (DEC-671)'
FROM public.admin_backfill_log
WHERE operation_type = 'photo_backfill' AND status = 'completed'
ON CONFLICT (id) DO NOTHING;

-- ──────────────────────────────────────────────────────────────────────────
-- Step 3: Delete all photo_backfill + category_fill rows from main table
-- (4 completed are already archived above; 2 failed + 17 pending are dropped.)
-- ──────────────────────────────────────────────────────────────────────────
DELETE FROM public.admin_backfill_log
WHERE operation_type IN ('photo_backfill', 'category_fill');

-- ──────────────────────────────────────────────────────────────────────────
-- Step 4: Shrink the operation_type CHECK constraint to 'place_refresh' only
-- ──────────────────────────────────────────────────────────────────────────
ALTER TABLE public.admin_backfill_log
  DROP CONSTRAINT IF EXISTS admin_backfill_log_operation_type_check;
ALTER TABLE public.admin_backfill_log
  ADD CONSTRAINT admin_backfill_log_operation_type_check
  CHECK (operation_type = 'place_refresh');

-- ──────────────────────────────────────────────────────────────────────────
-- Step 5: Drop 12 RPCs (Constitution #8 — subtract before add)
-- ──────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.admin_photo_pool_summary();
DROP FUNCTION IF EXISTS public.admin_photo_pool_missing_places(integer, integer);
DROP FUNCTION IF EXISTS public.admin_photo_pool_categories();
DROP FUNCTION IF EXISTS public.admin_photo_pool_locations();
DROP FUNCTION IF EXISTS public.admin_photo_pool_refresh_health();
DROP FUNCTION IF EXISTS public.admin_pool_category_detail(text);
DROP FUNCTION IF EXISTS public.admin_trigger_backfill(text, uuid[]);
DROP FUNCTION IF EXISTS public.admin_trigger_category_fill(
  text, double precision, double precision, integer, integer);
DROP FUNCTION IF EXISTS public.admin_pool_stats_overview();
DROP FUNCTION IF EXISTS public.admin_backfill_log_list(integer, integer);
DROP FUNCTION IF EXISTS public.admin_backfill_status(uuid);
DROP FUNCTION IF EXISTS public.admin_backfill_weekly_costs();

-- ──────────────────────────────────────────────────────────────────────────
-- Step 6: Post-condition assertions (raise if cleanup didn't take)
-- ──────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_remaining_orphans BIGINT;
  v_remaining_rpcs BIGINT;
  v_archive_count BIGINT;
BEGIN
  SELECT COUNT(*) INTO v_remaining_orphans FROM public.admin_backfill_log
    WHERE operation_type IN ('photo_backfill', 'category_fill');
  IF v_remaining_orphans > 0 THEN
    RAISE EXCEPTION 'ORCH-0671 post-condition FAILED: % orphan rows remain', v_remaining_orphans;
  END IF;

  SELECT COUNT(*) INTO v_remaining_rpcs FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'admin_photo_pool_summary','admin_photo_pool_missing_places',
        'admin_photo_pool_categories','admin_photo_pool_locations',
        'admin_photo_pool_refresh_health','admin_pool_category_detail',
        'admin_trigger_backfill','admin_trigger_category_fill',
        'admin_pool_stats_overview','admin_backfill_log_list',
        'admin_backfill_status','admin_backfill_weekly_costs'
      );
  IF v_remaining_rpcs > 0 THEN
    RAISE EXCEPTION 'ORCH-0671 post-condition FAILED: % RPCs not dropped', v_remaining_rpcs;
  END IF;

  SELECT COUNT(*) INTO v_archive_count
    FROM public.admin_backfill_log_archive_orch_0671;
  IF v_archive_count < 4 THEN
    RAISE EXCEPTION 'ORCH-0671 post-condition FAILED: archive holds % rows (expected ≥4)', v_archive_count;
  END IF;

  RAISE NOTICE 'ORCH-0671 migration: post-conditions OK. Orphans=0, RPCs dropped=12, archive=%', v_archive_count;
END $$;

COMMIT;
```

#### Rollback file

**Filename:** `supabase/migrations/20260428100002_orch_0671_ROLLBACK.sql`

This file is committed but **NOT applied automatically** — exists for `supabase db reset` recovery scenarios only. Body restores all 12 RPCs verbatim from their authoritative source migrations and restores the 23 deleted rows from `admin_backfill_log_archive_orch_0671` + reconstructs the 17 pending (which were not archived; rollback accepts that loss).

**Important:** Implementor **must paste each RPC body verbatim** from these source files into the rollback:

| RPC | Source migration |
|-----|------------------|
| `admin_photo_pool_summary`, `admin_photo_pool_categories` (original card_pool version), `admin_photo_pool_locations` (original), `admin_photo_pool_missing_places` (original), `admin_photo_pool_refresh_health` (original) | `supabase/migrations/20260405000001_split_photo_pool_overview.sql` |
| `admin_photo_pool_categories` (latest), `admin_photo_pool_locations` (latest), `admin_photo_pool_missing_places` (latest), `admin_photo_pool_refresh_health` (latest), `admin_pool_category_detail` (latest) | `supabase/migrations/20260425000014_orch_0640_rewrite_place_admin_rpcs.sql` |
| `admin_trigger_backfill`, `admin_trigger_category_fill`, `admin_pool_stats_overview`, `admin_backfill_log_list`, `admin_backfill_status`, `admin_backfill_weekly_costs` | `supabase/migrations/20260317100002_admin_photo_pool_management.sql` |

Rollback also restores the original CHECK constraint:
```sql
ALTER TABLE public.admin_backfill_log
  DROP CONSTRAINT IF EXISTS admin_backfill_log_operation_type_check;
ALTER TABLE public.admin_backfill_log
  ADD CONSTRAINT admin_backfill_log_operation_type_check
  CHECK (operation_type IN ('photo_backfill', 'category_fill', 'place_refresh'));
```

### §3.2 Edge function layer

**File:** `supabase/functions/backfill-place-photos/index.ts`

Behavioral changes: ZERO. Only:

| Line | Current | Target |
|------|---------|--------|
| 173 | `//   'initial'           — first-time city setup; filter ai_approved=true AND no real photos` | `//   'initial'           — first-time city setup; filter is_servable=true AND no real photos` |
| 186-187 | `is_servable?: boolean \| null;` declared on TWO consecutive lines | dedupe to ONE line |
| 197 | `blockedByAiApproval: number;` (in `RunPreviewAnalysis` interface) | `blockedByNotServable: number;` (single field; existing line 198 `blockedByNotServable: number;` is removed because line 197 is now the canonical name) |
| 217-220 | Comment block describes `'initial'` mode as `"original behavior: ai_approved=true AND lacks real photos"` | Replace `ai_approved` with `is_servable` |
| 232 | `blockedByAiApproval: 0,` | `blockedByNotServable: 0,` (was already declared but is now the only declaration) |
| 233 | `blockedByNotServable: 0,` | DELETE this line (consolidated above) |
| 256 | `analysis.blockedByAiApproval++; // field name kept for backward compat in report` | `analysis.blockedByNotServable++;` (drop the backward-compat comment — the rename eliminates the need for it) |
| 267 | `analysis.blockedByNotServable++;` | unchanged (now the same field as line 256 increments) |

**Net code-level effect:** `RunPreviewAnalysis` has ONE field `blockedByNotServable` instead of two; both `'initial'` and `'refresh_servable'` mode increment the same field; existing UI displays the single field once.

**Deploy implication:** This requires an edge function deploy (`supabase functions deploy backfill-place-photos`). The deploy MUST be paired with the UI commit that updates the consumer field name (see §3.5 lines 1394, 1737). If deployed alone, the UI would read `previewSummary.blockedByAiApproval` which would be `undefined`, and the "Not Bouncer Approved" stat card would render `"—"` until the UI catches up.

### §3.3 Service layer

N/A. Admin uses direct Supabase client calls. No service abstraction for these RPCs.

### §3.4 Hook layer

N/A. Admin uses React Context. No React Query hooks.

### §3.5 Component layer (admin)

**Delete:**

- File: `mingla-admin/src/pages/PhotoPoolManagementPage.jsx` — DELETE entirely (`git rm`)

**Edit:** `mingla-admin/src/App.jsx`

| Line | Action |
|------|--------|
| 17 | DELETE: `import { PhotoPoolManagementPage } from "./pages/PhotoPoolManagementPage"; // ORCH-0640 ch08: reattached from orphan` |
| 40 | DELETE: `  photos: PhotoPoolManagementPage,   // ORCH-0640 ch08: route added` |

**Edit:** `mingla-admin/src/lib/constants.js`

| Line | Action |
|------|--------|
| 139 | DELETE: `      { id: "photos", label: "Photo Pool", icon: "Camera" },` |

**Edit:** `mingla-admin/src/components/layout/Sidebar.jsx`

| Line | Action | Verification before edit |
|------|--------|--------------------------|
| 15 | DELETE: `  Camera,` (lucide-react named import) | Implementor MUST grep `mingla-admin/src/lib/constants.js` for `icon.*Camera` and confirm 0 remaining matches AFTER step above. If non-zero, abort this edit. |
| 31 | DELETE: `Camera, ` from the ICON_MAP destructure (between `CreditCard,` and `Mic,`) | Same verification |

**Edit:** `mingla-admin/src/pages/PlacePoolManagementPage.jsx` (5 label/comment edits + 3 field-rename consumer edits)

| Line | Current | Target |
|------|---------|--------|
| 1394 | `if (analysis.blockedByAiApproval > 0) parts.push(\`${formatCount(analysis.blockedByAiApproval)} not AI-approved\`);` | `if (analysis.blockedByNotServable > 0) parts.push(\`${formatCount(analysis.blockedByNotServable)} not Bouncer-approved\`);` |
| 1395 | `if (analysis.blockedByNotServable > 0) parts.push(\`${formatCount(analysis.blockedByNotServable)} not Bouncer-approved\`);` | DELETE this line (HF-I cleanup — line 1394 above already does this after rename) |
| 1737 | `<StatCard icon={AlertTriangle} label="Not AI Approved" value={previewSummary ? formatCount(previewSummary.blockedByAiApproval) : "—"} />` | `<StatCard icon={AlertTriangle} label="Not Bouncer Approved" value={previewSummary ? formatCount(previewSummary.blockedByNotServable) : "—"} />` |
| 1980 | `// Load AI-approved category breakdown (replaces old seeding_category stats)` | `// Load Bouncer-approved category breakdown (replaces old seeding_category stats)` |
| 2024 | `// AI-approved category breakdown (from admin_place_category_breakdown RPC)` | `// Bouncer-approved category breakdown (from admin_place_category_breakdown RPC)` |
| 2069 | `{/* Category breakdown — AI-approved only */}` | `{/* Category breakdown — Bouncer-approved only */}` |
| 2070 | `<SectionCard title="AI-Approved Places by Category">` | `<SectionCard title="Bouncer-Approved Places by Category">` |

**Edit:** `mingla-admin/src/components/seeding/RefreshTab.jsx` (per Q-671-2 = DELETE panel)

Implementor reads the file in full to identify all of:

1. The `poolHealth` state declaration (around line 47): `const [poolHealth, setPoolHealth] = useState(null);` — DELETE
2. The `setPoolHealth(null)` reset call inside the city-change useEffect (around line 66) — DELETE
3. The `admin_pool_stats_overview` RPC call block (lines 102-110) — DELETE in full, including:
   - The comment `// Pool health (admin_pool_stats_overview RPC)`
   - The `try { ... } catch { }` block
   - The `setPoolHealth(stats.refresh_health)` call
4. Any JSX rendering that reads `poolHealth` — DELETE the panel section (implementor greps `poolHealth` in the file to find all render usages and removes the entire `<div>` / `<SectionCard>` containing them)

After edits, implementor must confirm:
- `grep -c "poolHealth" mingla-admin/src/components/seeding/RefreshTab.jsx` returns 0
- `grep -c "admin_pool_stats_overview" mingla-admin/src/components/seeding/RefreshTab.jsx` returns 0

Net LOC delta on RefreshTab.jsx: estimated -25 to -50 lines (1 state decl + 1 reset call + 1 try-catch block + 1 JSX panel block).

### §3.6 Realtime

N/A. None of the touched code uses Supabase Realtime.

### §3.7 CI gate layer (`scripts/ci-check-invariants.sh`)

Append three new gates to the existing file (current file: 294 lines, last block at end is `exit 0`). Insert the new gates BEFORE the final `if [ $FAIL -eq 1 ]` block.

**Gate 1: I-LABEL-MATCHES-PREDICATE (admin UI)**

```bash
# ─── ORCH-0671 — I-LABEL-MATCHES-PREDICATE: no "AI Approved" / "AI Validated" labels in admin ───
# Per ORCH-0671: the bouncer signal replaces ai_approved as the sole serving gate.
# Admin UI labels must not say "AI Approved" or "AI Validated" because the underlying
# data is now the bouncer signal (is_servable). Inverse-naming = Constitution #9 violation.
LABEL_VIOLATIONS=$(git grep -lE "AI[ -]?(Approved|Validated)" \
    mingla-admin/src/ \
    2>/dev/null \
  | grep -vE '\.md$' \
  || true)
if [ -n "$LABEL_VIOLATIONS" ]; then
  echo "FAIL: I-LABEL-MATCHES-PREDICATE violation(s):"
  echo "  Admin UI label says 'AI Approved' or 'AI Validated' but the data is the"
  echo "  bouncer signal. Rename to 'Bouncer Approved' or 'Servable'."
  echo "$LABEL_VIOLATIONS"
  FAIL=1
fi
```

**Gate 2: I-OWNER-PER-OPERATION-TYPE (backend)**

```bash
# ─── ORCH-0671 — I-OWNER-PER-OPERATION-TYPE: every admin_backfill_log.operation_type value has 1 consumer ───
# Per ORCH-0671: dead operation_type values + zombie pending rows are a recurring failure
# pattern. After the cleanup, only 'place_refresh' remains; if any future migration adds a
# new operation_type, this gate confirms a consumer exists in supabase/functions/.
#
# Strategy: parse the latest CHECK constraint definition for allowed values; for each value,
# require ≥1 grep hit in supabase/functions/.
LATEST_OP_CONSTRAINT=$(ls -1 supabase/migrations/*.sql 2>/dev/null \
  | xargs grep -l "admin_backfill_log_operation_type_check" 2>/dev/null \
  | sort -r | head -1)
if [ -n "$LATEST_OP_CONSTRAINT" ]; then
  ALLOWED_VALUES=$(grep -oE "operation_type[[:space:]]*(=|IN)[[:space:]]*\(?'[^']+'(,[[:space:]]*'[^']+')*\)?" "$LATEST_OP_CONSTRAINT" \
    | tail -1 \
    | grep -oE "'[^']+'" \
    | tr -d "'")
  for op_value in $ALLOWED_VALUES; do
    CONSUMER_COUNT=$(git grep -lE "operation_type[[:space:]]*[,=]?[[:space:]]*[\"']${op_value}[\"']" \
        supabase/functions/ \
        2>/dev/null | wc -l)
    if [ "$CONSUMER_COUNT" -lt 1 ]; then
      echo "FAIL: I-OWNER-PER-OPERATION-TYPE violation:"
      echo "  admin_backfill_log.operation_type allows '$op_value' but no consumer in supabase/functions/"
      FAIL=1
    fi
  done
fi
```

**Gate 3: I-PHOTO-FILTER-EXPLICIT-EXTENSION (backend)**

```bash
# ─── ORCH-0671 — I-PHOTO-FILTER-EXPLICIT-EXTENSION: admin photo RPCs must gate on is_servable ───
# Per ORCH-0671: the standalone Photo Pool admin page surfaced 100% bouncer-rejected places
# as "missing photos" because its 5 RPCs filtered only on is_active. Any future RPC named
# admin_*photo* MUST gate on is_servable IS TRUE, OR explicitly comment "RAW POOL VIEW".
PHOTO_RPC_FILES=$(grep -lE "CREATE (OR REPLACE )?FUNCTION public\.admin_[a-z_]*photo[a-z_]*" \
  supabase/migrations/*.sql 2>/dev/null \
  | sort -r)
PHOTO_VIOLATIONS=""
for f in $PHOTO_RPC_FILES; do
  # Extract function names defined in this file matching admin_*photo*
  FN_NAMES=$(grep -oE "CREATE (OR REPLACE )?FUNCTION public\.admin_[a-z_]*photo[a-z_]*" "$f" \
    | sed -E 's/CREATE (OR REPLACE )?FUNCTION public\.//')
  for fn_name in $FN_NAMES; do
    # Check this is the LATEST migration defining this fn (skip historical)
    LATEST_FOR_FN=$(grep -lE "CREATE (OR REPLACE )?FUNCTION public\.${fn_name}" \
      supabase/migrations/*.sql 2>/dev/null | sort -r | head -1)
    if [ "$f" != "$LATEST_FOR_FN" ]; then continue; fi
    # Authoritative def — must contain is_servable OR "RAW POOL VIEW" justification
    if ! grep -E "is_servable|RAW POOL VIEW" "$f" > /dev/null 2>&1; then
      PHOTO_VIOLATIONS="$PHOTO_VIOLATIONS\n  $fn_name (defined in $f) lacks is_servable filter and no RAW POOL VIEW comment"
    fi
  done
done
if [ -n "$PHOTO_VIOLATIONS" ]; then
  echo "FAIL: I-PHOTO-FILTER-EXPLICIT-EXTENSION violation(s):"
  printf '%b\n' "$PHOTO_VIOLATIONS"
  echo "  Every admin_*photo* RPC must filter on is_servable IS TRUE,"
  echo "  OR the function body must contain a 'RAW POOL VIEW' comment justifying"
  echo "  the unfiltered aggregation (rare; e.g. admin tooling that intentionally"
  echo "  needs to see the entire pool including bouncer-rejected places)."
  FAIL=1
fi
```

**Negative-control reproduction (mandatory per `feedback_forensic_thoroughness.md` and ORCH-0669 precedent):**

For each of the 3 new gates, the implementor runs:

1. Inject a violation matching the gate's pattern (e.g., add `<StatCard label="AI Approved" />` to a test file)
2. Run `./scripts/ci-check-invariants.sh` — expect exit 1 with the named violation in stderr
3. Revert the injection
4. Run again — expect exit 0

The implementor pastes the literal stdout/stderr of all three forward-control + recovery cycles into the implementation report (6 outputs total).

---

## §4 — Invariants

### Preserved (existing — must not regress)

- **I-POOL-ONLY-SERVING** (ORCH-0640) — no `card_pool` references in admin/mobile/edge fns. Verified: this spec adds zero card_pool references.
- **I-BOUNCER-IS-QUALITY-GATE** (ORCH-0640 + ORCH-0646) — no `ai_approved`/`ai_override`/`ai_validated` references in serving code or admin frontend. Verified: this spec REMOVES `ai_approved` from comments and renames `blockedByAiApproval` to `blockedByNotServable`. Net: the existing CI gate gets MORE compliance, not less.
- **I-PHOTO-FILTER-EXPLICIT** (ORCH-0598.11) — `backfill-place-photos` modes `'initial'`/`'refresh_servable'` both gate on `is_servable=true`. Verified: this spec changes only comments/types in the edge fn; runtime behavior preserved.
- **Constitution #2** (one owner per truth) — IMPROVED. Two parallel backfill systems collapse to one.
- **Constitution #3** (no silent failures) — IMPROVED. RefreshTab's silent-swallow catch block is removed (Q-671-2).
- **Constitution #8** (subtract before adding) — HONORED. Net code change is deletion-heavy (~−1,500 LOC).
- **Constitution #9** (no fabricated data) — IMPROVED. Phantom $695.63/mo cost banner is removed; "AI Approved" labels removed from labeled-bouncer data.

### NEW (this spec establishes 3)

#### I-LABEL-MATCHES-PREDICATE

**Rule:** Every UI label of the form `"X-approved"` / `"X Approved"` / `"X-Validated"` / `"X Validated"` MUST cite the actual approval predicate it counts. In the admin frontend specifically, `"AI Approved"` and `"AI Validated"` are BANNED — the underlying data is the bouncer signal (`is_servable`); the legacy `ai_approved` column was dropped by ORCH-0640.

**Enforcement:** CI gate (§3.7 Gate 1) — `grep -E "AI[ -]?(Approved|Validated)" mingla-admin/src` returns 0 hits.

**Test:** `grep -rE "AI[ -]?(Approved|Validated)" mingla-admin/src` → empty. Inject `<StatCard label="AI Approved" />` → CI gate fails. Revert → gate passes.

**Why:** Investigation §4 documented 5 places where bouncer-aware data was labeled "AI Approved" — operator-trust violation (Constitution #9 fabricated framing) and pattern-repeat of ORCH-0640/ORCH-0646 cleanup misses.

#### I-OWNER-PER-OPERATION-TYPE

**Rule:** Every value allowed by `admin_backfill_log.operation_type` CHECK constraint MUST have at least one consumer in `supabase/functions/` that processes rows of that type. New operation_type values without a consumer create zombie pending rows (per ORCH-0671's 17 zombies).

**Enforcement:** CI gate (§3.7 Gate 2) — parse latest CHECK constraint, for each allowed value require ≥1 grep hit on `operation_type ... = '<value>'` or `operation_type ... 'value'` in `supabase/functions/`.

**Test:** Add `'photo_backfill'` back to the constraint via test migration → CI gate fails (no consumer). Revert → gate passes.

**Why:** Investigation §6 (HF-D) + Constitution #2 — adding a new operation_type without a consumer is a Constitution #2 violation (ownership gap) AND a Constitution #3 violation (silent zombie rows that look "in progress" forever).

#### I-PHOTO-FILTER-EXPLICIT-EXTENSION

**Rule:** Every Postgres function named `admin_*photo*` MUST gate aggregations and projections on `is_servable IS TRUE`. Exception: a function that intentionally surfaces the unfiltered pool MUST contain a comment with the literal string `"RAW POOL VIEW"` justifying the unfiltered aggregation.

**Enforcement:** CI gate (§3.7 Gate 3) — for each `admin_*photo*` function defined in the LATEST migration that touches it, body must contain `is_servable` OR `RAW POOL VIEW`.

**Test:** Add a new function `admin_photo_test_v2()` defined as `SELECT COUNT(*) FROM place_pool WHERE is_active = true` → CI gate fails. Add `-- RAW POOL VIEW: intentional` comment → gate passes.

**Why:** Investigation §3 measured 65-95% noise in the deleted page's category counts because all 5 RPCs filtered only on `is_active`. This invariant prevents recurrence on any future admin photo aggregation.

---

## §5 — Success Criteria

Numbered, observable, testable. Tester verifies all 15 before PASS.

| SC# | Criterion | How to verify |
|-----|-----------|---------------|
| SC-01 | File `mingla-admin/src/pages/PhotoPoolManagementPage.jsx` does not exist | `test ! -f mingla-admin/src/pages/PhotoPoolManagementPage.jsx` |
| SC-02 | No remaining import of `PhotoPoolManagementPage` anywhere | `git grep "PhotoPoolManagement" mingla-admin/src/` returns empty |
| SC-03 | App.jsx PAGES map has no `photos` key | `grep "photos:" mingla-admin/src/App.jsx` returns 0 lines |
| SC-04 | Sidebar nav has no "Photo Pool" entry | `grep '"Photo Pool"' mingla-admin/src/lib/constants.js` returns 0 lines |
| SC-05 | Sidebar.jsx no longer imports `Camera` from lucide-react | `grep -E "^\s*Camera," mingla-admin/src/components/layout/Sidebar.jsx` returns 0 lines |
| SC-06 | All 12 RPCs absent from live DB | `SELECT COUNT(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN (<12 names>)` = 0 |
| SC-07 | `admin_backfill_log.operation_type` CHECK constraint allows only `'place_refresh'` | `SELECT consrc FROM pg_constraint WHERE conname='admin_backfill_log_operation_type_check'` shows `(operation_type = 'place_refresh'::text)` |
| SC-08 | No orphan rows remain in `admin_backfill_log` | `SELECT COUNT(*) FROM admin_backfill_log WHERE operation_type IN ('photo_backfill','category_fill')` = 0 |
| SC-09 | Archive table holds 4 historical rows with $84.88 spend | `SELECT COUNT(*) AS n, SUM(estimated_cost_usd) AS sum_cost FROM admin_backfill_log_archive_orch_0671` returns `n=4, sum_cost=84.8750` |
| SC-10 | UI label "Not AI Approved" replaced by "Not Bouncer Approved" | Open Place Pool page → select city → Photos tab → preview → StatCard reads "Not Bouncer Approved" |
| SC-11 | Section title "Bouncer-Approved Places by Category" renders | Open Place Pool page → select city → Stats tab → SectionCard title reads "Bouncer-Approved Places by Category" |
| SC-12 | Preview breakdown text uses "Bouncer-approved" not "AI-approved" | Open Place Pool page → city → Photos tab → click "Initial Download" preview → text contains "Bouncer-approved" and not "AI-approved" |
| SC-13 | Edge fn `RunPreviewAnalysis` returns single field `blockedByNotServable` | After deploy: invoke `backfill-place-photos` with `action: "preview_run"` and a city — response JSON contains `analysis.blockedByNotServable` numeric and does NOT contain `analysis.blockedByAiApproval` |
| SC-14 | RefreshTab no longer renders pool-health panel and no console errors | Open Place Pool page → Seeding tab → Refresh sub-tab → no "Pool Health" / "Stale" / "Recently Served" panel rendered above the per-city refresh controls; browser console clean of `admin_pool_stats_overview` errors |
| SC-15 | `cd mingla-admin && npm run build` exits 0 with zero warnings about missing imports or undefined variables | Run command, inspect exit code + stderr |
| SC-16 | All 3 new CI gates pass on a clean checkout | `./scripts/ci-check-invariants.sh` exits 0 |
| SC-17 | All 3 new CI gates fire on injected violations | Per gate: inject canonical violation → run gate → exit 1 with named violation; revert → exit 0 |
| SC-18 | `admin-refresh-places` edge fn still consumes `place_refresh` rows post-migration | Trigger a `place_refresh` via `admin_trigger_place_refresh('all_stale')` from PSQL (as authed admin) → confirm row appears in `admin_backfill_log` with status `pending` → wait for cron pickup OR invoke `admin-refresh-places` with `action: "process_pending"` → row transitions to `running` then `completed` |
| SC-19 | Hash route `#/photos` falls back to default `#/overview` | Navigate browser to `https://admin.mingla/#/photos` → URL stays at `#/photos` but page renders Overview (per [App.jsx:51](mingla-admin/src/App.jsx#L51) `getTabFromHash` fallback) |
| SC-20 | I-LABEL-MATCHES-PREDICATE CI gate finds zero violations | `grep -rE "AI[ -]?(Approved\|Validated)" mingla-admin/src` returns 0 lines |

---

## §6 — Test Cases

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-01 | Page deletion verified | `find mingla-admin/src/pages -name "PhotoPoolManagementPage.jsx"` | empty | filesystem |
| T-02 | Hash route fallback | navigate to `#/photos` | renders Overview, console clean | UI |
| T-03 | Sidebar visual | open admin in browser | no "Photo Pool" entry | UI |
| T-04 | All 12 RPCs dropped | `SELECT proname FROM pg_proc WHERE proname = ANY(<12 names>)` | 0 rows | DB |
| T-05 | CHECK constraint shrunk | `\d+ admin_backfill_log` (or PSQL equivalent in supabase MCP) | constraint shows `(operation_type = 'place_refresh'::text)` | DB |
| T-06 | Orphan rows cleared | `SELECT COUNT(*) FROM admin_backfill_log WHERE operation_type IN ('photo_backfill','category_fill')` | 0 | DB |
| T-07 | Archive populated | `SELECT id, status, estimated_cost_usd, archive_reason FROM admin_backfill_log_archive_orch_0671` | 4 rows, all status=completed, cost sums to $84.88, reason='ORCH-0671 photo_backfill consumer retired (DEC-671)' | DB |
| T-08 | INSERT with old operation_type fails | `INSERT INTO admin_backfill_log (operation_type, triggered_by, status, total_places) VALUES ('photo_backfill', auth.uid(), 'pending', 0)` (as admin) | CHECK constraint violation `23514` | DB |
| T-09 | StatCard label change | open Place Pool > city > Photos tab > preview | StatCard reads "Not Bouncer Approved" with numeric value | UI |
| T-10 | SectionCard title change | open Place Pool > city > Stats tab | SectionCard title is "Bouncer-Approved Places by Category" | UI |
| T-11 | Preview breakdown text | open Place Pool > city > Photos tab > click "Initial Download" preview | text contains "Bouncer-approved", does NOT contain "AI-approved" | UI |
| T-12 | Edge fn field rename live | invoke `backfill-place-photos` with `{ action: "preview_run", cityId: <test_city_id> }` | response JSON contains `analysis.blockedByNotServable` (numeric); does NOT contain `analysis.blockedByAiApproval` | edge fn |
| T-13 | RefreshTab no panel | open Place Pool > Seeding tab > Refresh sub-tab | "Pool Health" panel absent; browser console has zero entries matching `admin_pool_stats_overview` | UI |
| T-14 | Build passes | `cd mingla-admin && npm run build` | exit 0; no warnings about missing imports/undefined vars | tooling |
| T-15 | CI gate I-LABEL-MATCHES-PREDICATE forward control | inject `<StatCard label="AI Approved" />` to scratch test file; run `./scripts/ci-check-invariants.sh` | exit 1; stderr contains "I-LABEL-MATCHES-PREDICATE violation" | CI |
| T-16 | CI gate I-LABEL-MATCHES-PREDICATE recovery | revert injection from T-15; rerun gate | exit 0 | CI |
| T-17 | CI gate I-OWNER-PER-OPERATION-TYPE forward control | apply temp migration adding `'photo_backfill'` to constraint; rerun gate | exit 1; stderr contains "I-OWNER-PER-OPERATION-TYPE violation" naming `photo_backfill` | CI |
| T-18 | CI gate I-OWNER-PER-OPERATION-TYPE recovery | revert temp migration; rerun gate | exit 0 | CI |
| T-19 | CI gate I-PHOTO-FILTER-EXPLICIT-EXTENSION forward control | add temp migration `CREATE FUNCTION admin_photo_test_v2() RETURNS BIGINT AS $$ SELECT COUNT(*) FROM place_pool WHERE is_active = true $$ LANGUAGE sql;`; rerun gate | exit 1; stderr names `admin_photo_test_v2` | CI |
| T-20 | CI gate I-PHOTO-FILTER-EXPLICIT-EXTENSION recovery via comment | append `-- RAW POOL VIEW: test fixture` to the test migration; rerun gate | exit 0 | CI |
| T-21 | CI gate I-PHOTO-FILTER-EXPLICIT-EXTENSION recovery via filter | replace test migration body with `WHERE is_active = true AND is_servable IS TRUE`; rerun gate | exit 0 | CI |
| T-22 | place_refresh still works end-to-end | as authenticated admin: `SELECT public.admin_trigger_place_refresh('all_stale')` → invoke `admin-refresh-places` with `action: "process_pending"` → poll status | log row transitions pending→running→completed; `success_count > 0` if any stale places exist | full stack regression |
| T-23 | Live admin smoke (cross-browser) | sign in as actual admin, navigate every remaining tab on Place Pool page (Overview, Browse, Map, Seeding, Refresh, Photos, Excluded, Stats) | every tab loads without console errors; Photos tab download buttons are bouncer-aware (existing behavior preserved) | end-to-end |
| T-24 | Mobile app regression check | open mobile app on iOS + Android; complete one full Discover swipe + save | no behavior change (admin-only spec; mobile must not be affected) | regression |
| T-25 | Archive table read-only by client | as authenticated user (NOT service role): `SELECT * FROM admin_backfill_log_archive_orch_0671` | RLS denies / 0 rows (only service_role policy exists) | security |

---

## §7 — Implementation Order

The implementor MUST execute in this exact order. Each step has a verification checkpoint.

| Step | Action | Verification before next step |
|------|--------|--------------------------------|
| 1 | Re-run §0 pre-flight verification (5 steps) | All pass; if any fails → STOP and return to orchestrator |
| 2 | Edit `mingla-admin/src/App.jsx` — DELETE lines 17 + 40 | `grep -c "PhotoPoolManagement" mingla-admin/src/App.jsx` = 0 |
| 3 | Edit `mingla-admin/src/lib/constants.js` — DELETE line 139 | `grep -c '"Photo Pool"' mingla-admin/src/lib/constants.js` = 0 |
| 4 | Verify Camera icon orphan: `grep -c '"Camera"' mingla-admin/src/lib/constants.js` | If 0 → proceed to step 5; if > 0 → SKIP step 5 (Camera still in use) |
| 5 | Edit `mingla-admin/src/components/layout/Sidebar.jsx` — remove `Camera` from import (line 15) and from ICON_MAP destructure (line 31) | `grep -c "Camera" mingla-admin/src/components/layout/Sidebar.jsx` = 0 |
| 6 | DELETE `mingla-admin/src/pages/PhotoPoolManagementPage.jsx` (`git rm`) | `test ! -f mingla-admin/src/pages/PhotoPoolManagementPage.jsx` |
| 7 | Edit `mingla-admin/src/pages/PlacePoolManagementPage.jsx` — apply 8 changes per §3.5 (lines 1394, 1395 DELETE, 1737, 1980, 2024, 2069, 2070, plus the field-rename consumer updates inline) | `grep -E "AI[ -]?(Approved\|Validated)" mingla-admin/src/pages/PlacePoolManagementPage.jsx` = 0 |
| 8 | Edit `mingla-admin/src/components/seeding/RefreshTab.jsx` — DELETE `poolHealth` state + RPC call + catch + JSX panel per §3.5 | `grep -c "poolHealth\|admin_pool_stats_overview" mingla-admin/src/components/seeding/RefreshTab.jsx` = 0 |
| 9 | Edit `supabase/functions/backfill-place-photos/index.ts` — apply 7 changes per §3.2 (lines 173, 186-187 dedupe, 197 rename, 217-220, 232 rename, 233 DELETE, 256 + comment, 267 unchanged) | `grep -c "blockedByAiApproval" supabase/functions/backfill-place-photos/index.ts` = 0; `grep -c "ai_approved" supabase/functions/backfill-place-photos/index.ts` = 0 |
| 10 | Run `cd mingla-admin && npm run build` | exit 0, no warnings about missing imports/undefined vars |
| 11 | Append 3 new CI gates to `scripts/ci-check-invariants.sh` per §3.7 | File length ≥ 294 + ~70 lines of new gate code |
| 12 | Run forward-control + recovery tests for ALL 3 new CI gates per T-15..T-21 (6 cycles total) — paste literal stdout/stderr to implementation report | Each forward control exits 1 with named violation; each recovery exits 0 |
| 13 | Update `Mingla_Artifacts/INVARIANT_REGISTRY.md` — add 3 new invariant entries per §4 | Verify file gains the 3 sections |
| 14 | Run baseline `./scripts/ci-check-invariants.sh` (no injections) | Exit 0 |
| 15 | Write the migration file `supabase/migrations/20260428100001_orch_0671_drop_photo_pool_admin_surface.sql` per §3.1 (verbatim SQL) | File exists, syntactically valid (`psql --dry-run` if available) |
| 16 | Write the rollback file `supabase/migrations/20260428100002_orch_0671_ROLLBACK.sql` per §3.1 (verbatim function bodies pasted from source migrations) | File exists, all 12 function bodies present |
| 17 | Commit UI + edge-fn + invariant + CI gate + migration files (single commit) — DO NOT apply migration yet | Commit message per §8 below |
| 18 | Deploy edge function: `supabase functions deploy backfill-place-photos --project-ref gqnoajqerqhnvulmnyvv` | Deployment success log |
| 19 | Push UI commit to remote, merge if PR-based | UI ships to admin |
| 20 | **WAIT 24 HOURS** while admins use the rebuilt UI; monitor Supabase logs for any unexpected calls to the to-be-dropped RPCs (should be zero — page is gone) | After 24h, run `mcp__supabase__get_logs` filter for the 12 RPC names — expect 0 hits |
| 21 | Apply migration via `supabase db push` (or Supabase dashboard SQL editor for the verbatim file body) | Migration completes; post-condition assertions raise NOTICE only, not EXCEPTION |
| 22 | Run all DB success criteria SC-06, SC-07, SC-08, SC-09 via supabase MCP | All 4 pass |
| 23 | Hand off to tester with full test matrix per §6 | Tester runs all 25 tests + reports verdict |

---

## §8 — Deploy Order + Rollback

### Deploy order (locked)

1. UI commit + edge fn deploy ship FIRST (the dropped RPCs are now ungoverned but no UI calls them)
2. 24-hour soak: monitor Supabase logs for any unexpected calls to the 12 RPCs (zero expected)
3. Migration applies SECOND — RPCs drop only after we've proven nothing calls them

This avoids the broken-state window where: migration applied first → UI still references dropped RPCs → admin sees errors. Investigation §6 already documented `setupNeeded` silently masking renamed-RPC errors as "Setup Required" (HF-F) — we explicitly avoid that failure mode by reversing the deploy order.

### Rollback procedure

If anything goes wrong after migration apply:

1. Apply `supabase/migrations/20260428100002_orch_0671_ROLLBACK.sql` via Supabase dashboard SQL editor (do NOT auto-apply through `supabase db push` — file is named with future timestamp to stay unapplied by default)
2. Re-run baseline: `./scripts/ci-check-invariants.sh` (the new I-LABEL gate may fail because UI still has old labels — accept that as expected post-rollback noise)
3. `git revert` the UI commit + edge fn deploy commit
4. Open ORCH-0671-RECOVERY ticket with what failed and why

### Commit message (single commit for steps 2-17)

```
ORCH-0671: delete standalone Photo Pool admin page; relabel Photos tab on Place Pool

Founder Q-671-1 = Option C (DELETE). Investigation proved the standalone /photos
admin page was bouncer-blind across all 5 RPCs (counted 100% bouncer-rejected
places as "missing photos to backfill") AND its trigger button had no consumer
(17 zombie pending rows since 2026-04-02). Photos tab on Place Pool page is
bouncer-correct in behavior; only labels were stale.

What changed:
- Delete mingla-admin/src/pages/PhotoPoolManagementPage.jsx (1,366 lines)
- Remove import + route from App.jsx
- Remove "Photo Pool" sidebar nav entry from constants.js
- Remove Camera lucide-react import from Sidebar.jsx (last consumer deleted)
- Relabel "Not AI Approved" → "Not Bouncer Approved" on Place Pool > Photos tab
- Relabel "AI-Approved Places by Category" → "Bouncer-Approved Places by Category"
- Update 3 stale comments on PlacePoolManagementPage.jsx
- Rename RunPreviewAnalysis.blockedByAiApproval → blockedByNotServable in
  backfill-place-photos edge fn; consolidate double-counted UI line
- Dedupe duplicated TS interface field in backfill-place-photos
- Remove broken admin_pool_stats_overview call + dead pool-health panel from
  Seeding > RefreshTab (Q-671-2 = delete; was already silently failing per
  Constitution #3 — RPC doesn't exist in live DB)
- Add 3 new invariants to INVARIANT_REGISTRY.md with CI gates:
    I-LABEL-MATCHES-PREDICATE
    I-OWNER-PER-OPERATION-TYPE
    I-PHOTO-FILTER-EXPLICIT-EXTENSION
- Add migration to drop 12 unused RPCs + shrink admin_backfill_log.operation_type
  CHECK to 'place_refresh' only + archive 4 historical photo_backfill spend rows
  to admin_backfill_log_archive_orch_0671 + delete 19 orphan rows

Constitution: #2 RESTORED (single backfill system = backfill-place-photos), #3
IMPROVED (RefreshTab silent-swallow eliminated), #8 HONORED (~-1,500 LOC),
#9 IMPROVED (phantom $695.63/mo cost banner gone; "AI Approved" labels gone).

Deploy order: UI ship first → 24h Supabase log soak → migration apply.

Spec: Mingla_Artifacts/specs/SPEC_ORCH-0671_PHOTO_POOL_DELETE_AND_RELABEL.md
Investigation: Mingla_Artifacts/reports/INVESTIGATION_ORCH-0671_PHOTO_TAB_BOUNCER_AWARENESS.md
```

---

## §9 — Self-Review Checklist (Spec Writer)

Per dispatch §8 — every box ticked before submission:

- [x] §0 pre-flight queries written with expected results (5 queries, 5 results documented in §0)
- [x] DEC-671 (archive vs delete historical rows) decided with rationale (HYBRID — archive 4 completed, delete 19 others; rationale in §1)
- [x] Q-671-2 (RefreshTab panel fate) decided with rationale (DELETE — already silently broken; rationale in §1)
- [x] All 12 RPCs to drop have exact signatures from `pg_get_functiondef`-style query (live `pg_proc` join in §0; verbatim signatures in §3.1 and the spec body)
- [x] Migration is idempotent (every operation uses `IF EXISTS` / `IF NOT EXISTS` / `ON CONFLICT DO NOTHING`; safe to re-run)
- [x] Rollback file written separately (`20260428100002_orch_0671_ROLLBACK.sql` — referenced in §3.1, with explicit pasted-bodies instruction)
- [x] All 5 UI label edits have exact line numbers + before/after (§3.5 table)
- [x] Edge fn comment cleanup exact line numbers (§3.2 table covers lines 173, 186-187, 197, 217-220, 232, 233, 256)
- [x] Field rename: edge fn + UI consumer both updated in same diff (single commit message in §8)
- [x] RefreshTab edits scope-bounded with grep verification (poolHealth + admin_pool_stats_overview both must reach 0 grep matches; LOC delta estimated -25 to -50)
- [x] 3 invariants added to registry with CI gate code (§3.7 + §4 — full bash for each gate, not pseudocode)
- [x] CI gate negative-control test defined (T-15..T-21 = 7 tests covering forward + recovery for all 3 gates; implementor must paste literal stdout/stderr per Step 12)
- [x] ≥12 test cases (T-01..T-25 = 25 tests; required ≥12)
- [x] ≥10 success criteria (SC-01..SC-20 = 20 SCs; required ≥10)
- [x] Implementation order numbered (Steps 1-23 in §7; required ≥12)
- [x] Deploy order explicit (UI before migration; §8 with explicit 24h soak window)
- [x] Net LOC delta computed (~-1,500 LOC: page deletion 1,366 + RefreshTab panel ~30-50 + spec edits/additions ~100-150 net positive in CI script + migration + invariants but negative-dominated)
- [x] No app-mobile changes (§2 non-goals)
- [x] No scope creep into D-2 / D-4 / D-7 (D-7 resolved by deletion; D-2 + D-4 explicitly deferred in §2)
- [x] Founder constraints honored (DELETE locked; no global photo-health view rebuilt; admin_trigger_category_fill killed)

All checkboxes ticked. Spec is BINDING. Hand off to orchestrator review.

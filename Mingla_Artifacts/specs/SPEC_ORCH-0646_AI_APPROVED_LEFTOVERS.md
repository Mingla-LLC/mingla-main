# SPEC — ORCH-0646: ai_approved leftovers cleanup

**Severity:** S1 (admin Place Pool + Signal Library broken in production)
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0646_AI_APPROVED_LEFTOVERS.md`
**Dispatch:** `Mingla_Artifacts/prompts/SPEC_ORCH-0646_AI_APPROVED_LEFTOVERS.md`
**Author:** mingla-forensics (SPEC mode)
**Status:** READY FOR IMPLEMENTOR — all decisions locked, no open questions

---

## Amendment to Investigation (corrections)

Forensics SPEC-mode re-verification caught two items to correct against the investigation report:

- **H-1 DOWNGRADED 🔴→🔵 (observation only):** `admin_place_pool_city_list` is **already rewritten** in `supabase/migrations/20260425000014_orch_0640_rewrite_place_admin_rpcs.sql:417-442`. Body uses `mv.is_servable = TRUE` (not `mv.ai_approved`); the archived `card_pool` queries are already replaced with `0::bigint AS existing_cards` + `0::bigint AS ready_to_generate`. Legacy return-field names `approved_places` kept per rewrite comment at L428. **Not called by** `PlacePoolManagementPage.jsx` or `SignalLibraryPage.jsx` in the current code — so no JSX action needed either. REMOVED from spec scope.
- **Partial H-REGRESSION-GATE:** CI script `scripts/ci-check-invariants.sh:29-43` already has an `ai_approved` grep gate for serving code (discover-cards, generate-curated-experiences, get-person-hero-cards, get-paired-saves, app-mobile/src/), BUT explicitly does **not** include `mingla-admin/src/`. Closing this single coverage gap closes the ORCH-0646 recurrence vector. This is the only CI-script edit needed (not a new gate).

Final fix scope: **6 DB functions** (not 7) + **23 JSX sites** (PlacePoolManagementPage + SignalLibraryPage) + **1 CI script line** + **1 invariant registry entry**.

---

## 1. Scope

### In scope (hard-locked)

**DB migration** — one new file:
- Path: `supabase/migrations/20260424000001_orch_0646_ai_approved_cleanup.sql` (timestamp sorts after the ORCH-0640 cutover bundle dated `20260425000001..000014` — note: the `20260424` prefix is intentional and below `20260425` would cause it to apply BEFORE ORCH-0640 cutover which has ALREADY been applied in production; so the correct prefix is `20260426000001` — implementor MUST use `20260426000001_orch_0646_ai_approved_cleanup.sql` so the migration applies AFTER ORCH-0640 cutover that's already in prod)
- 6 function rewrites (5 DROP+CREATE because return types change; 2 CREATE OR REPLACE because only body changes)

**JSX files:**
- `mingla-admin/src/pages/PlacePoolManagementPage.jsx` — 23 edit sites (22 from investigation + 1 AI Override block)
- `mingla-admin/src/pages/SignalLibraryPage.jsx` — 5 edit sites

**CI script:**
- `scripts/ci-check-invariants.sh` — extend line 35 of the AI_VIOLATIONS check to include `mingla-admin/src/`

**Artifacts:**
- `Mingla_Artifacts/INVARIANT_REGISTRY.md` — append `I-COLUMN-DROP-CLEANUP-EXHAUSTIVE`

### Out of scope (hard scope-lock — implementor MUST NOT touch)

- `PhotoPoolManagementPage.jsx` (deferred as ORCH-0647)
- AI Validation page (archived per ORCH-0640; retire-or-delete decision separate)
- Any new admin-override RPC (`admin_override_servable` or similar — deferred per D-3)
- `existing_cards` / `ready_to_generate` real data (will need `engagement_metrics`-backed replacement; separate ORCH-ID)
- Mobile code (`app-mobile/src/`) — not touched
- Edge functions (`supabase/functions/`) — not touched
- RLS policies — unchanged (existing `is_admin_user()` check inside each RPC is preserved)
- `admin_place_pool_city_list` / `admin_place_pool_country_list` / `admin_pool_category_detail` / `admin_pool_category_health` / `admin_city_pipeline_status` — already ORCH-0640-clean; do not re-touch

### Non-goals

- Backfilling historic `bouncer_validated_at` for rows where `ai_validated_at` was populated
- Re-running Bouncer on any existing rows
- UI redesign of stats cards / filter dropdown beyond label renames
- Performance tuning (keeping current query shapes; rewrite migration preserved query-plan hints)

---

## 2. Pre-flight verification (mandatory — run BEFORE any code change)

Implementor runs these three SQL probes on the live Supabase DB (via dashboard SQL editor or MCP if available) and documents results in the implementation report. If ANY returns unexpected output, HALT and return to orchestrator.

```sql
-- GATE 1: Confirm column dropped from place_pool
SELECT column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name='place_pool' AND column_name='ai_approved';
-- Expected: 0 rows

-- GATE 2: Confirm admin_place_pool_mv rebuilt without ai_approved
SELECT column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name='admin_place_pool_mv' AND column_name='ai_approved';
-- Expected: 0 rows
-- Also confirm presence: `is_servable` should be in the column list.
SELECT string_agg(column_name, ', ') FROM information_schema.columns
WHERE table_schema='public' AND table_name='admin_place_pool_mv';
-- Expected to include: is_servable, bouncer_validated_at, bouncer_reason, has_photos

-- GATE 3: Confirm the 6 broken RPCs still exist with stale body
SELECT proname, pg_get_functiondef(oid) ~ 'ai_approved' AS has_stale_ref
FROM pg_proc WHERE proname IN (
  'admin_city_picker_data',
  'admin_place_pool_overview',
  'admin_place_country_overview',
  'admin_place_city_overview',
  'admin_place_category_breakdown',
  'admin_place_photo_stats'
) ORDER BY proname;
-- Expected: all 6 present; has_stale_ref = true for all 6
```

If GATE 1 or GATE 2 returns rows (column still present) → abort; means ORCH-0640 cutover was rolled back and this fix is wrong-direction. If GATE 3 shows missing RPCs or has_stale_ref=false → abort; means someone else already fixed them.

---

## 3. Database layer — exact SQL

Migration file: `supabase/migrations/20260426000001_orch_0646_ai_approved_cleanup.sql`

Full content below. Implementor writes it verbatim, header comment adjusted per `references/artifact-templates.md` if available:

```sql
-- ORCH-0646 — Rewrite 6 admin RPCs that still reference dropped ai_approved column.
-- Root cause: ORCH-0640 ch03 rebuilt admin_place_pool_mv without ai_approved, and ch13
-- dropped place_pool.ai_approved. Rewrite migration ch05 (20260425000014) covered 14
-- RPCs but these 6 were missed — still reference mv.ai_approved (4) or pp.ai_approved (1).
-- This migration completes the cleanup by DROP+CREATE with renamed return fields.
--
-- See Mingla_Artifacts/specs/SPEC_ORCH-0646_AI_APPROVED_LEFTOVERS.md for full rationale.
-- Orchestrator-locked decisions: Direction B (clean rename), D-3 read-only viewer.
--
-- Prerequisites (verified via pre-flight gates — see spec §2):
--   - place_pool.ai_approved column dropped (by 20260425000004)
--   - admin_place_pool_mv rebuilt without ai_approved, with is_servable (by 20260425000003)
--   - ORCH-0640 cutover applied end-to-end (confirmed live 2026-04-23 evening)
--
-- 3-state semantics preserved: `is_servable` is BOOLEAN NULLable.
--   TRUE  = Bouncer judged servable (replaces ai_approved=true)
--   FALSE = Bouncer judged excluded (replaces ai_approved=false)
--   NULL  = Not yet judged by Bouncer (replaces ai_approved=null)
--
-- Return-field renames:
--   ai_approved_places / ai_approved_count → is_servable_places / is_servable_count
--   ai_validated_count → bouncer_judged_count
--   ai_rejected_count  → bouncer_excluded_count
--   ai_pending_count   → bouncer_pending_count
--   ai_validated_pct   → bounced_pct

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. admin_city_picker_data — pp.ai_approved → pp.is_servable
-- Return-field rename: ai_approved_places → is_servable_places
-- ═══════════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.admin_city_picker_data();
CREATE OR REPLACE FUNCTION public.admin_city_picker_data()
RETURNS TABLE (
  city_id UUID,
  city_name TEXT,
  country_name TEXT,
  country_code TEXT,
  city_status TEXT,
  is_servable_places BIGINT,
  total_active_places BIGINT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM admin_users au WHERE au.email = auth.email() AND au.status = 'active'
  ) THEN RAISE EXCEPTION 'Not authorized'; END IF;

  RETURN QUERY
  SELECT
    sc.id AS city_id,
    sc.name AS city_name,
    sc.country AS country_name,
    sc.country_code,
    sc.status AS city_status,
    (SELECT COUNT(*) FROM place_pool pp
     WHERE pp.city_id = sc.id AND pp.is_active AND pp.is_servable = true
    ) AS is_servable_places,
    (SELECT COUNT(*) FROM place_pool pp
     WHERE pp.city_id = sc.id AND pp.is_active
    ) AS total_active_places
  FROM seeding_cities sc
  ORDER BY sc.country, sc.name;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. admin_place_pool_overview — mv.ai_approved × 21 → mv.is_servable
-- Return-field renames: ai_approved_places/count/ai_validated_count/ai_rejected_count/ai_pending_count
-- ═══════════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.admin_place_pool_overview(uuid, text);
CREATE OR REPLACE FUNCTION public.admin_place_pool_overview(
  p_city_id uuid DEFAULT NULL::uuid,
  p_country_code text DEFAULT NULL::text
)
RETURNS TABLE(
  total_places bigint,
  active_places bigint,
  is_servable_places bigint,
  with_photos bigint,
  photo_pct integer,
  bouncer_judged_count bigint,
  is_servable_count bigint,
  bouncer_excluded_count bigint,
  bouncer_pending_count bigint,
  distinct_categories integer
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_total BIGINT;
  v_active BIGINT;
  v_servable BIGINT;
  v_with_photos BIGINT;
  v_judged BIGINT;
  v_excluded BIGINT;
  v_pending BIGINT;
  v_categories INTEGER;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM admin_users WHERE email = auth.email() AND status = 'active'
  ) THEN RAISE EXCEPTION 'Not authorized'; END IF;

  -- City-scoped: single narrow query. MV's city_id index narrows to ~5k rows max.
  IF p_city_id IS NOT NULL THEN
    RETURN QUERY
    SELECT
      COUNT(*)::BIGINT,
      COUNT(*) FILTER (WHERE mv.is_active)::BIGINT,
      COUNT(*) FILTER (WHERE mv.is_active AND mv.is_servable = true)::BIGINT,
      COUNT(*) FILTER (WHERE mv.is_active AND mv.is_servable = true AND mv.has_photos)::BIGINT,
      CASE WHEN COUNT(*) FILTER (WHERE mv.is_active AND mv.is_servable = true) > 0
        THEN ROUND(
          COUNT(*) FILTER (WHERE mv.is_active AND mv.is_servable = true AND mv.has_photos) * 100.0
          / COUNT(*) FILTER (WHERE mv.is_active AND mv.is_servable = true)
        )::INTEGER
        ELSE 0 END,
      COUNT(*) FILTER (WHERE mv.is_active AND mv.is_servable IS NOT NULL)::BIGINT,
      COUNT(*) FILTER (WHERE mv.is_active AND mv.is_servable = true)::BIGINT,
      COUNT(*) FILTER (WHERE mv.is_active AND mv.is_servable = false)::BIGINT,
      COUNT(*) FILTER (WHERE mv.is_active AND mv.is_servable IS NULL)::BIGINT,
      COUNT(DISTINCT mv.primary_category) FILTER (
        WHERE mv.is_active AND mv.is_servable = true AND mv.primary_category <> 'uncategorized'
      )::INTEGER
    FROM admin_place_pool_mv mv
    WHERE mv.city_id = p_city_id;
    RETURN;
  END IF;

  -- Country-scoped: single narrow query. MV's country_code index narrows to one country's rows.
  IF p_country_code IS NOT NULL THEN
    RETURN QUERY
    SELECT
      COUNT(*)::BIGINT,
      COUNT(*) FILTER (WHERE mv.is_active)::BIGINT,
      COUNT(*) FILTER (WHERE mv.is_active AND mv.is_servable = true)::BIGINT,
      COUNT(*) FILTER (WHERE mv.is_active AND mv.is_servable = true AND mv.has_photos)::BIGINT,
      CASE WHEN COUNT(*) FILTER (WHERE mv.is_active AND mv.is_servable = true) > 0
        THEN ROUND(
          COUNT(*) FILTER (WHERE mv.is_active AND mv.is_servable = true AND mv.has_photos) * 100.0
          / COUNT(*) FILTER (WHERE mv.is_active AND mv.is_servable = true)
        )::INTEGER
        ELSE 0 END,
      COUNT(*) FILTER (WHERE mv.is_active AND mv.is_servable IS NOT NULL)::BIGINT,
      COUNT(*) FILTER (WHERE mv.is_active AND mv.is_servable = true)::BIGINT,
      COUNT(*) FILTER (WHERE mv.is_active AND mv.is_servable = false)::BIGINT,
      COUNT(*) FILTER (WHERE mv.is_active AND mv.is_servable IS NULL)::BIGINT,
      COUNT(DISTINCT mv.primary_category) FILTER (
        WHERE mv.is_active AND mv.is_servable = true AND mv.primary_category <> 'uncategorized'
      )::INTEGER
    FROM admin_place_pool_mv mv
    WHERE mv.country_code = p_country_code;
    RETURN;
  END IF;

  -- Global scope: 8 narrow subqueries, each eligible for Index-Only Scan via mv_country_active_servable index.
  SELECT COUNT(*) INTO v_total FROM admin_place_pool_mv;
  SELECT COUNT(*) INTO v_active FROM admin_place_pool_mv WHERE is_active;
  SELECT COUNT(*) INTO v_servable FROM admin_place_pool_mv WHERE is_active AND is_servable = true;
  SELECT COUNT(*) INTO v_with_photos FROM admin_place_pool_mv
    WHERE is_active AND is_servable = true AND has_photos;
  SELECT COUNT(*) INTO v_judged FROM admin_place_pool_mv WHERE is_active AND is_servable IS NOT NULL;
  SELECT COUNT(*) INTO v_excluded FROM admin_place_pool_mv WHERE is_active AND is_servable = false;
  SELECT COUNT(*) INTO v_pending FROM admin_place_pool_mv WHERE is_active AND is_servable IS NULL;
  SELECT COUNT(DISTINCT primary_category)::INTEGER INTO v_categories
    FROM admin_place_pool_mv
    WHERE is_active AND is_servable = true AND primary_category <> 'uncategorized';

  RETURN QUERY SELECT
    v_total,
    v_active,
    v_servable,
    v_with_photos,
    CASE WHEN v_servable > 0 THEN ROUND(v_with_photos * 100.0 / v_servable)::INTEGER ELSE 0 END,
    v_judged,
    v_servable,
    v_excluded,
    v_pending,
    v_categories;
END;
$function$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. admin_place_country_overview — mv.ai_approved × 7 → mv.is_servable
-- Return-field renames: ai_approved_places → is_servable_places; ai_validated_pct → bounced_pct
-- ═══════════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.admin_place_country_overview();
CREATE OR REPLACE FUNCTION public.admin_place_country_overview()
RETURNS TABLE(
  country_code text,
  country_name text,
  city_count bigint,
  is_servable_places bigint,
  photo_pct integer,
  bounced_pct integer,
  category_coverage integer
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM admin_users WHERE email = auth.email() AND status = 'active'
  ) THEN RAISE EXCEPTION 'Not authorized'; END IF;

  RETURN QUERY
  WITH per_country AS (
    SELECT
      mv.country_code,
      COUNT(*) FILTER (WHERE mv.is_active AND mv.is_servable = true)                           AS is_servable_places,
      COUNT(*) FILTER (WHERE mv.is_active AND mv.is_servable = true AND mv.has_photos)         AS servable_with_photos,
      COUNT(*) FILTER (WHERE mv.is_active AND mv.is_servable IS NOT NULL)                      AS bouncer_judged_count,
      COUNT(*) FILTER (WHERE mv.is_active)                                                     AS active_total,
      COUNT(DISTINCT mv.primary_category) FILTER (
        WHERE mv.is_active AND mv.is_servable = true AND mv.primary_category <> 'uncategorized'
      )                                                                                        AS category_coverage
    FROM admin_place_pool_mv mv
    WHERE mv.country_code IS NOT NULL
    GROUP BY mv.country_code
  ),
  countries AS (
    SELECT DISTINCT country_code, country FROM seeding_cities
  ),
  city_counts AS (
    SELECT sc.country_code, COUNT(*)::bigint AS city_count
    FROM seeding_cities sc
    GROUP BY sc.country_code
  )
  SELECT
    c.country_code,
    c.country AS country_name,
    cc.city_count,
    COALESCE(pc.is_servable_places, 0) AS is_servable_places,
    CASE WHEN COALESCE(pc.is_servable_places, 0) > 0
      THEN ROUND(pc.servable_with_photos * 100.0 / pc.is_servable_places)::INTEGER
      ELSE 0
    END AS photo_pct,
    CASE WHEN COALESCE(pc.active_total, 0) > 0
      THEN ROUND(pc.bouncer_judged_count * 100.0 / pc.active_total)::INTEGER
      ELSE 0
    END AS bounced_pct,
    COALESCE(pc.category_coverage, 0)::INTEGER AS category_coverage
  FROM countries c
  JOIN city_counts cc ON cc.country_code = c.country_code
  LEFT JOIN per_country pc ON pc.country_code = c.country_code
  ORDER BY COALESCE(pc.is_servable_places, 0) DESC;
END;
$function$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. admin_place_city_overview — mv.ai_approved × 8 → mv.is_servable
-- Return-field renames: ai_approved_places → is_servable_places; ai_validated_pct → bounced_pct
-- ═══════════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.admin_place_city_overview(text);
CREATE OR REPLACE FUNCTION public.admin_place_city_overview(p_country_code text)
RETURNS TABLE(
  city_id uuid,
  city_name text,
  is_servable_places bigint,
  photo_pct integer,
  bounced_pct integer,
  category_coverage integer,
  avg_rating numeric
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM admin_users WHERE email = auth.email() AND status = 'active'
  ) THEN RAISE EXCEPTION 'Not authorized'; END IF;

  RETURN QUERY
  WITH per_city AS (
    SELECT
      mv.city_id,
      COUNT(*) FILTER (WHERE mv.is_active AND mv.is_servable = true)                                      AS is_servable_places,
      COUNT(*) FILTER (WHERE mv.is_active AND mv.is_servable = true AND mv.has_photos)                    AS servable_with_photos,
      COUNT(*) FILTER (WHERE mv.is_active AND mv.is_servable IS NOT NULL)                                 AS bouncer_judged_count,
      COUNT(*) FILTER (WHERE mv.is_active)                                                                AS active_total,
      COUNT(DISTINCT mv.primary_category) FILTER (
        WHERE mv.is_active AND mv.is_servable = true AND mv.primary_category <> 'uncategorized'
      )                                                                                                    AS category_coverage,
      AVG(mv.rating) FILTER (WHERE mv.is_active AND mv.is_servable = true AND mv.rating IS NOT NULL)       AS avg_rating
    FROM admin_place_pool_mv mv
    WHERE mv.country_code = p_country_code
    GROUP BY mv.city_id
  )
  SELECT
    sc.id AS city_id,
    sc.name AS city_name,
    COALESCE(pc.is_servable_places, 0)::BIGINT AS is_servable_places,
    CASE WHEN COALESCE(pc.is_servable_places, 0) > 0
      THEN ROUND(pc.servable_with_photos * 100.0 / pc.is_servable_places)::INTEGER ELSE 0
    END AS photo_pct,
    CASE WHEN COALESCE(pc.active_total, 0) > 0
      THEN ROUND(pc.bouncer_judged_count * 100.0 / pc.active_total)::INTEGER ELSE 0
    END AS bounced_pct,
    COALESCE(pc.category_coverage, 0)::INTEGER AS category_coverage,
    ROUND(pc.avg_rating::NUMERIC, 1) AS avg_rating
  FROM seeding_cities sc
  LEFT JOIN per_city pc ON pc.city_id = sc.id
  WHERE sc.country_code = p_country_code
  ORDER BY COALESCE(pc.is_servable_places, 0) DESC;
END;
$function$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. admin_place_category_breakdown — single mv.ai_approved → mv.is_servable (body only)
-- Return shape unchanged. Using CREATE OR REPLACE since signature unchanged.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.admin_place_category_breakdown(
  p_city_id uuid DEFAULT NULL::uuid,
  p_country_code text DEFAULT NULL::text
)
RETURNS TABLE(
  category text,
  place_count bigint,
  photo_pct integer,
  avg_rating numeric
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM admin_users WHERE email = auth.email() AND status = 'active'
  ) THEN RAISE EXCEPTION 'Not authorized'; END IF;

  RETURN QUERY
  SELECT
    mv.primary_category AS category,
    COUNT(*)::BIGINT AS place_count,
    CASE WHEN COUNT(*) > 0
      THEN ROUND(COUNT(*) FILTER (WHERE mv.has_photos) * 100.0 / COUNT(*))::INTEGER
      ELSE 0
    END AS photo_pct,
    ROUND((AVG(mv.rating) FILTER (WHERE mv.rating IS NOT NULL))::NUMERIC, 1) AS avg_rating
  FROM admin_place_pool_mv mv
  WHERE mv.is_active
    AND mv.is_servable = true
    AND mv.primary_category <> 'uncategorized'
    AND (p_city_id IS NULL OR mv.city_id = p_city_id)
    AND (p_country_code IS NULL OR mv.country_code = p_country_code)
  GROUP BY mv.primary_category
  ORDER BY COUNT(*) DESC;
END;
$function$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. admin_place_photo_stats — single mv.ai_approved → mv.is_servable (body only)
-- Return shape unchanged. Using CREATE OR REPLACE since signature unchanged.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.admin_place_photo_stats(p_city_id uuid)
RETURNS TABLE(
  total_places bigint,
  with_photos bigint,
  without_photos bigint
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM admin_users WHERE email = auth.email() AND status = 'active'
  ) THEN RAISE EXCEPTION 'Not authorized'; END IF;

  RETURN QUERY
  SELECT
    COUNT(*)::BIGINT AS total_places,
    COUNT(*) FILTER (WHERE mv.has_photos)::BIGINT AS with_photos,
    COUNT(*) FILTER (WHERE NOT mv.has_photos)::BIGINT AS without_photos
  FROM admin_place_pool_mv mv
  WHERE mv.city_id = p_city_id
    AND mv.is_active
    AND mv.is_servable = true;
END;
$function$;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- POST-APPLY verification (run manually after `supabase db push`):
-- ═══════════════════════════════════════════════════════════════════════════
--   -- Confirm no stale refs remain
--   SELECT proname FROM pg_proc
--   WHERE proname IN ('admin_city_picker_data','admin_place_pool_overview',
--                     'admin_place_country_overview','admin_place_city_overview',
--                     'admin_place_category_breakdown','admin_place_photo_stats')
--     AND pg_get_functiondef(oid) ~ 'ai_approved';
--   -- Expected: 0 rows
--
--   -- Smoke-test each function succeeds on prod data
--   SELECT * FROM admin_city_picker_data() LIMIT 1;
--   SELECT * FROM admin_place_pool_overview(NULL, NULL);
--   SELECT * FROM admin_place_country_overview() LIMIT 1;
--   SELECT * FROM admin_place_city_overview('US') LIMIT 1;
--   SELECT * FROM admin_place_category_breakdown(NULL, 'US') LIMIT 1;
--   SELECT * FROM admin_place_photo_stats(
--     (SELECT id FROM seeding_cities WHERE country_code='US' LIMIT 1)
--   );
-- ═══════════════════════════════════════════════════════════════════════════

-- ROLLBACK plan: if this migration breaks production, roll back by re-applying
--   20260418000001_orch0481_admin_mv_layer.sql (for category_breakdown, photo_stats,
--   and the admin_place_*_overview family) and 20260409200001_optimize_city_picker_rpc.sql
--   (for admin_city_picker_data). Note: that rollback will restore the BROKEN ai_approved
--   references — intended only as a recovery path if the new return-type rename causes
--   an unforeseen downstream JSX breakage. Prefer forward-fix.
```

**Notes for implementor:**
- Filename MUST be `20260426000001_orch_0646_ai_approved_cleanup.sql` (not `20260424000001_…` as in the dispatch — the dispatch timestamp is wrong because it would sort BEFORE `20260425000001` ORCH-0640 cutover which is already in prod; later timestamp is correct).
- Do NOT modify any other function. Specifically: do NOT re-touch `admin_place_pool_city_list`, `admin_place_pool_country_list`, `admin_pool_category_detail`, `admin_pool_category_health`, `admin_city_pipeline_status` — they are ORCH-0640-clean already.
- Every function preserves the existing `is_admin_user()`-equivalent auth check (pattern: `IF NOT EXISTS (SELECT 1 FROM admin_users …)`).
- Query-plan hints (`admin_place_pool_mv_country_active_servable` index etc.) are preserved via unchanged query shapes.

---

## 4. JSX layer — `PlacePoolManagementPage.jsx` (23 sites)

Apply in order. Each site shows BEFORE → AFTER. Line numbers are from current commit; small drift acceptable if implementor cross-references the context.

### 4.1 — L134 render field rename
```jsx
// BEFORE
<span className="text-xs text-[var(--color-text-tertiary)]">{(c.ai_approved_places || 0).toLocaleString()}</span>
// AFTER
<span className="text-xs text-[var(--color-text-tertiary)]">{(c.is_servable_places || 0).toLocaleString()}</span>
```

### 4.2 — L247 dual-field fallback rename
```jsx
// BEFORE
const aiPct = data.active_places > 0 ? Math.round(((data.ai_approved_places || data.ai_approved_count || 0) / data.active_places) * 100) : 0;
// AFTER
const servablePct = data.active_places > 0 ? Math.round(((data.is_servable_places || data.is_servable_count || 0) / data.active_places) * 100) : 0;
// Also: renaming local `aiPct` → `servablePct` — update consumer below (L309).
```

### 4.3 — L259 country drill-down column
```jsx
// BEFORE
{ key: "ai_approved_places", label: "AI Approved", sortable: true, render: (_, r) => (r.ai_approved_places || 0).toLocaleString() },
// AFTER
{ key: "is_servable_places", label: "Servable", sortable: true, render: (_, r) => (r.is_servable_places || 0).toLocaleString() },
```

### 4.4 — L261 country drill-down column label rename
```jsx
// BEFORE
{ key: "ai_validated_pct", label: "AI Validated %", sortable: true, render: (_, r) => <Badge variant={pctColor(r.ai_validated_pct || 0)}>{r.ai_validated_pct || 0}%</Badge> },
// AFTER
{ key: "bounced_pct", label: "Bounced %", sortable: true, render: (_, r) => <Badge variant={pctColor(r.bounced_pct || 0)}>{r.bounced_pct || 0}%</Badge> },
```

### 4.5 — L270 city drill-down column (mirror of 4.3)
```jsx
// BEFORE
{ key: "ai_approved_places", label: "AI Approved", sortable: true, render: (_, r) => (r.ai_approved_places || 0).toLocaleString() },
// AFTER
{ key: "is_servable_places", label: "Servable", sortable: true, render: (_, r) => (r.is_servable_places || 0).toLocaleString() },
```

### 4.6 — L272 city drill-down column (mirror of 4.4)
```jsx
// BEFORE
{ key: "ai_validated_pct", label: "AI Validated %", sortable: true, render: (_, r) => <Badge variant={pctColor(r.ai_validated_pct || 0)}>{r.ai_validated_pct || 0}%</Badge> },
// AFTER
{ key: "bounced_pct", label: "Bounced %", sortable: true, render: (_, r) => <Badge variant={pctColor(r.bounced_pct || 0)}>{r.bounced_pct || 0}%</Badge> },
```

### 4.7 — L284 catColumns "place_count" label update (stale copy)
```jsx
// BEFORE
{ key: "place_count", label: "AI Approved", sortable: true },
// AFTER
{ key: "place_count", label: "Servable", sortable: true },
```
(Reason: the underlying `place_count` field on `admin_place_category_breakdown` already filters by `is_servable=true` (post-migration), so "Servable" is the accurate label.)

### 4.8 — L309-312 StatCard AI Validated section rename
```jsx
// BEFORE (L309-312)
<StatCard icon={Eye} label="AI Validated" value={`${aiPct}%`}
  trend={`${data.ai_validated_count} of ${data.active_places}`} trendUp={aiPct >= 50} />
<StatCard icon={Clock} label="Pending Review" value={data.ai_pending_count || 0}
  trend={data.ai_pending_count === 0 ? "All validated" : "Needs validation"} trendUp={data.ai_pending_count === 0} />
// AFTER
<StatCard icon={Eye} label="Bouncer Judged" value={`${servablePct}%`}
  trend={`${data.bouncer_judged_count} of ${data.active_places}`} trendUp={servablePct >= 50} />
<StatCard icon={Clock} label="Not Yet Bounced" value={data.bouncer_pending_count || 0}
  trend={data.bouncer_pending_count === 0 ? "All judged" : "Needs Bouncer pass"} trendUp={data.bouncer_pending_count === 0} />
```

### 4.9 — L316-323 "AI Validation Summary" SectionCard rename
```jsx
// BEFORE (L316-323)
{(data.ai_pending_count > 0 || data.ai_validated_count > 0) && (
  <SectionCard title="AI Validation Summary">
    <div className="grid grid-cols-4 gap-4">
      <StatCard label="Validated" value={data.ai_validated_count} />
      <StatCard label="Approved" value={data.ai_approved_count} />
      <StatCard label="Rejected" value={data.ai_rejected_count} />
      <StatCard label="Pending" value={data.ai_pending_count} />
    </div>
  </SectionCard>
// AFTER
{(data.bouncer_pending_count > 0 || data.bouncer_judged_count > 0) && (
  <SectionCard title="Bouncer Summary">
    <div className="grid grid-cols-4 gap-4">
      <StatCard label="Judged" value={data.bouncer_judged_count} />
      <StatCard label="Servable" value={data.is_servable_count} />
      <StatCard label="Excluded" value={data.bouncer_excluded_count} />
      <StatCard label="Not Yet Bounced" value={data.bouncer_pending_count} />
    </div>
  </SectionCard>
```

### 4.10 — L355-360 editForm useState init: drop 4 fields (Hidden Flaw #3)
```jsx
// BEFORE
const [aiCard, setAiCard] = useState(null);
const [expandedPhoto, setExpandedPhoto] = useState(null);
const [editForm, setEditForm] = useState({
  name: "", price_tiers: [], seeding_category: "", is_active: true,
  ai_approved: null, ai_primary_identity: "", ai_categories: [], ai_reason: "", ai_confidence: null,
});
// AFTER
// aiCard state DELETED (always null post ORCH-0640; all consumers removed in 4.12, 4.13, 4.15)
const [expandedPhoto, setExpandedPhoto] = useState(null);
const [editForm, setEditForm] = useState({
  name: "", price_tiers: [], seeding_category: "", is_active: true,
  ai_categories: [],
});
```

### 4.11 — L363-380 useEffect sync: drop 4 setEditForm assignments + setAiCard call
```jsx
// BEFORE (L363-380)
useEffect(() => {
  if (!open || !place) return;
  setEditForm({
    name: place.name || "",
    price_tiers: place.price_tiers?.length ? place.price_tiers : (place.price_tier ? [place.price_tier] : []),
    seeding_category: place.seeding_category || "",
    is_active: place.is_active,
    ai_approved: place.ai_approved,
    ai_primary_identity: place.ai_primary_identity || "",
    ai_categories: place.ai_categories || [],
    ai_reason: place.ai_reason || "",
    ai_confidence: place.ai_confidence,
  });
  // ORCH-0640 ch08: card_pool archived — aiCard lookup retired. Any AI-validation
  // metadata the admin needs now comes from place_pool columns directly (bouncer_reason,
  // ai_categories). Set stub so downstream renders don't crash.
  setAiCard(null);
}, [open, place]);
// AFTER
useEffect(() => {
  if (!open || !place) return;
  setEditForm({
    name: place.name || "",
    price_tiers: place.price_tiers?.length ? place.price_tiers : (place.price_tier ? [place.price_tier] : []),
    seeding_category: place.seeding_category || "",
    is_active: place.is_active,
    ai_categories: place.ai_categories || [],
  });
}, [open, place]);
```

### 4.12 — L386 `aiCats` dead-branch cleanup
```jsx
// BEFORE
const aiCats = place.ai_categories?.length > 0 ? place.ai_categories : aiCard?.ai_categories || [];
// AFTER
const aiCats = place.ai_categories || [];
```

### 4.13 — L389-394 `aiStatusBadge` rewrite (read is_servable, rename copy)
```jsx
// BEFORE
const aiStatusBadge = () => {
  const approved = place.ai_approved ?? aiCard?.ai_approved;
  if (approved === true) return <Badge variant="success">Approved</Badge>;
  if (approved === false) return <Badge variant="error">Rejected</Badge>;
  return <Badge variant="outline">Pending</Badge>;
};
// AFTER
const bouncerStatusBadge = () => {
  if (place.is_servable === true) return <Badge variant="success">Servable</Badge>;
  if (place.is_servable === false) return <Badge variant="error">Excluded</Badge>;
  return <Badge variant="outline">Not Yet Bounced</Badge>;
};
```
**Update consumer at L511:** `{aiStatusBadge()}` → `{bouncerStatusBadge()}`. Also update label at L511 "AI Status:" → "Bouncer Status:".

### 4.14 — L411 inline editor AI write block: UNCHANGED (already scrubbed in ORCH-0640 ch08)
No action. The block only writes `ai_categories` (a non-dropped column). Comment at L409-410 stays.

### 4.15 — L513-515 DELETE dead aiCard ai_reason render branch
```jsx
// BEFORE
{aiCard?.ai_reason && aiCard?.ai_approved === false && (
  <div><span className="text-[var(--color-text-secondary)]">AI Reason:</span> <span className="text-[var(--color-error-600)]">{aiCard.ai_reason}</span></div>
)}
// AFTER
// (entire block DELETED — aiCard always null, both conditions fail)
// If the place row has `bouncer_reason` and is_servable=false, surface it:
{place.is_servable === false && place.bouncer_reason && (
  <div><span className="text-[var(--color-text-secondary)]">Bouncer Reason:</span> <span className="text-[var(--color-error-600)]">{place.bouncer_reason}</span></div>
)}
```

### 4.16 — L581-597 DELETE entire "AI Classification Override" block (per D-3)
```jsx
// BEFORE (L581-597)
{/* AI Override Controls */}
<div>
  <h4 className="text-xs font-semibold text-[var(--color-text-tertiary)] uppercase tracking-wider mb-2">AI Classification Override</h4>
  <div className="space-y-3">
    <div className="grid grid-cols-2 gap-3">
      <div>
        <label className="text-xs text-[var(--color-text-secondary)]">AI Status</label>
        <select className="block mt-1 w-full rounded border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-2 py-1.5 text-sm"
          value={editForm.ai_approved === null ? "" : editForm.ai_approved ? "true" : "false"}
          onChange={(e) => setEditForm((f) => ({ ...f, ai_approved: e.target.value === "" ? null : e.target.value === "true" }))}>
          <option value="">Pending</option>
          <option value="true">Approved</option>
          <option value="false">Rejected</option>
        </select>
      </div>
      <Input label="Primary Identity" value={editForm.ai_primary_identity} placeholder="e.g. restaurant, spa, museum"
        onChange={(e) => setEditForm((f) => ({ ...f, ai_primary_identity: e.target.value }))} />
    </div>
// AFTER
// (entire "AI Classification Override" heading + status dropdown + Primary Identity input DELETED
// — per D-3 admin does not override Bouncer judgment. AI Categories section below stays.)
```
Implementor: find the closing `</div>` that matches the outer `<div>` at L582 and delete the whole block. The "AI Categories (select all that apply)" block at L599+ stays (still editable).

### 4.17 — L1077-1079 map-view `.select` + `.eq` rename
```jsx
// BEFORE (L1076-1080)
let q = supabase.from("place_pool")
  .select("id, name, lat, lng, rating, ai_categories, seeding_category, is_active, stored_photo_urls, ai_approved")
  .eq("is_active", true)
  .eq("ai_approved", true)
  .eq("city_id", selectedCity);
// AFTER
let q = supabase.from("place_pool")
  .select("id, name, lat, lng, rating, ai_categories, seeding_category, is_active, stored_photo_urls, is_servable")
  .eq("is_active", true)
  .eq("is_servable", true)
  .eq("city_id", selectedCity);
```

### 4.18 — L1229-1231 three-state filter dropdown
```jsx
// BEFORE (L1229-1231)
if (filters.aiStatus === "validated") q = q.eq("ai_approved", true);
else if (filters.aiStatus === "rejected") q = q.eq("ai_approved", false);
else if (filters.aiStatus === "pending") q = q.is("ai_approved", null);
// AFTER
if (filters.servableStatus === "servable") q = q.eq("is_servable", true);
else if (filters.servableStatus === "excluded") q = q.eq("is_servable", false);
else if (filters.servableStatus === "not_bounced") q = q.is("is_servable", null);
```

### 4.18a — filter-state hooks: find the filter state declaration elsewhere in the file (earlier `useState` with `aiStatus`), rename key `aiStatus` → `servableStatus`, and update the corresponding dropdown UI option values from `"validated"/"rejected"/"pending"` → `"servable"/"excluded"/"not_bounced"` with labels `"Servable" / "Excluded" / "Not Yet Bounced"`.

### 4.19 — L1254 column render: rename column key + badge
```jsx
// BEFORE (L1270-1274)
{ key: "ai_approved", label: "AI Status", render: (_, r) => {
  if (r.ai_approved === true) return <Badge variant="success">Approved</Badge>;
  if (r.ai_approved === false) return <Badge variant="error">Rejected</Badge>;
  return <Badge variant="outline">Pending</Badge>;
}},
// AFTER
{ key: "is_servable", label: "Bouncer Status", render: (_, r) => {
  if (r.is_servable === true) return <Badge variant="success">Servable</Badge>;
  if (r.is_servable === false) return <Badge variant="error">Excluded</Badge>;
  return <Badge variant="outline">Not Yet Bounced</Badge>;
}},
```

### 4.20 — L1495, L1799, L1809 stale comments: rename `ai_approved` → `is_servable`
Plain text comment updates. Implementor pastes verbatim context; keep any ORCH-0598.11 markers intact.

### 4.21 — L2275-2310 `fetchRejected` + DELETE `handleApprove` + button
```jsx
// BEFORE (L2275-2288 fetchRejected)
const fetchRejected = useCallback(async () => {
  setLoading(true);
  let q = supabase.from("place_pool")
    .select("*", { count: "exact" })
    .eq("is_active", true)
    .eq("ai_approved", false);
  if (scope.cityId) q = q.eq("city_id", scope.cityId);
  ...
// AFTER
const fetchExcluded = useCallback(async () => {
  setLoading(true);
  let q = supabase.from("place_pool")
    .select("*", { count: "exact" })
    .eq("is_active", true)
    .eq("is_servable", false);
  if (scope.cityId) q = q.eq("city_id", scope.cityId);
  ...
```
Rename hook `fetchRejected` → `fetchExcluded` everywhere in scope (also at L2290 invocation).

**DELETE L2293-2310 `handleApprove` function entirely.** No replacement.

**DELETE** wherever the "Approve" button is rendered that invokes `handleApprove` (implementor greps for `handleApprove` and `approveModal` within the same functional component; removes the button, the modal trigger, and any `approveModal` state hooks).

### 4.22 — L2475 render field rename
```jsx
// BEFORE
const totalApproved = pickerCities.reduce((s, c) => s + (c.ai_approved_places || 0), 0);
// AFTER
const totalServable = pickerCities.reduce((s, c) => s + (c.is_servable_places || 0), 0);
// Update the consumer label wherever `totalApproved` is rendered — "Total Approved" → "Total Servable"
```

### 4.23 — Tab label rename (search-and-replace)
Find the tab config for the "Rejected" tab (likely a tabs array or `<Tab>` component somewhere in the page with label text "Rejected"). Rename label → "Bouncer-Excluded". Tab key may stay or rename to `excluded` — implementor's call.

---

## 5. JSX layer — `SignalLibraryPage.jsx` (5 sites)

### 5.1 — L374 render rename (Hidden Flaw #2 fix)
```jsx
// BEFORE
<td className="px-3 py-2"><StageCell done={Number(r.ai_approved_count ?? 0)} total={Number(r.total_active ?? 0)} /></td>
// AFTER
<td className="px-3 py-2"><StageCell done={Number(r.is_servable_count ?? 0)} total={Number(r.total_active ?? 0)} /></td>
```
(Note: `admin_city_pipeline_status` in `20260425000014:73-77` returns `is_servable_count`; JSX was not updated. This is the silent-zero fix.)

### 5.2 — L728 stale comment
```jsx
// BEFORE
// ORCH-0598.11: load city list. Default to highest ai_approved_places city
// (typically Raleigh today) so an admin opening the page sees something.
// AFTER
// ORCH-0598.11: load city list. Default to highest is_servable_places city
// (typically Raleigh today) so an admin opening the page sees something.
```

### 5.3 — L740 sort comparator
```jsx
// BEFORE
const sorted = (data ?? []).slice().sort(
  (a, b) => Number(b.ai_approved_places ?? 0) - Number(a.ai_approved_places ?? 0),
);
// AFTER
const sorted = (data ?? []).slice().sort(
  (a, b) => Number(b.is_servable_places ?? 0) - Number(a.is_servable_places ?? 0),
);
```

### 5.4 — L854 city picker dropdown render
```jsx
// BEFORE
{Number(c.ai_approved_places ?? 0).toLocaleString()} approved /{" "}
{Number(c.total_active_places ?? 0).toLocaleString()} active
// AFTER
{Number(c.is_servable_places ?? 0).toLocaleString()} servable /{" "}
{Number(c.total_active_places ?? 0).toLocaleString()} active
```

### 5.5 — search-and-replace sweep
After edits 5.1-5.4, run `grep -n 'ai_approved' mingla-admin/src/pages/SignalLibraryPage.jsx` — expect ZERO remaining matches. If any hit appears, investigate and resolve (do NOT leave any).

---

## 6. CI script change — one line

`scripts/ci-check-invariants.sh`, lines 29-43 (the AI_VIOLATIONS check). Add `mingla-admin/src/` to the paths scanned:

```bash
# BEFORE (lines 29-38 showing change context)
AI_VIOLATIONS=$(git grep -l "ai_approved\|ai_override\|ai_validated" \
    supabase/functions/discover-cards/ \
    supabase/functions/generate-curated-experiences/ \
    supabase/functions/get-person-hero-cards/ \
    supabase/functions/get-paired-saves/ \
    app-mobile/src/ \
    2>/dev/null \
  | grep -vE '\.md$' \
  || true)

# AFTER
AI_VIOLATIONS=$(git grep -l "ai_approved\|ai_override\|ai_validated" \
    supabase/functions/discover-cards/ \
    supabase/functions/generate-curated-experiences/ \
    supabase/functions/get-person-hero-cards/ \
    supabase/functions/get-paired-saves/ \
    app-mobile/src/ \
    mingla-admin/src/ \
    2>/dev/null \
  | grep -vE '\.md$' \
  || true)
```

Add an explanatory comment above line 29 referencing the new coverage:

```bash
# ─── I-BOUNCER-IS-QUALITY-GATE: no ai_approved in serving code or admin frontend ───
# ORCH-0646 extension (2026-04-23): mingla-admin/src/ added after ORCH-0640 cleanup
# gap allowed ai_approved references to persist in admin pages after column drop.
# Must not regress — admin reads the same dropped column and would 500.
```

---

## 7. Invariant registration

Append to `Mingla_Artifacts/INVARIANT_REGISTRY.md`:

```markdown
### I-COLUMN-DROP-CLEANUP-EXHAUSTIVE

**Registered:** 2026-04-23 (ORCH-0646)

**Rule:** Any migration that drops a column (or renames a MV projection) MUST be
paired with grep gates before its cutover migration is considered ready:

1. Grep `mingla-admin/src/` for the dropped column name — ZERO matches.
2. Grep `app-mobile/src/` for the dropped column name — ZERO matches.
3. Grep `supabase/functions/` for the dropped column name — ZERO matches
   (allowing deletion-proving comments like `// ORCH-XXXX ch13: COLUMN dropped`).
4. Inspect every function body in `public` schema via
   `SELECT pg_get_functiondef(oid) FROM pg_proc` grep for the column name —
   ZERO matches (or only in functions scheduled for drop in the same cutover).

**Enforcement:** CI script `scripts/ci-check-invariants.sh` covers gates (1)-(3)
at the source-tree level. Gate (4) is a manual pre-cutover check until there's
automation against live DB.

**Origin:** ORCH-0646 — ORCH-0640 dropped `place_pool.ai_approved` on 2026-04-23
with mobile cleanup verified and 14 admin RPCs rewritten, but six other RPCs and
23 admin JSX sites were missed. Admin Place Pool + Signal Library broke in prod
for hours until the user surfaced it. CLOSE Grade A was awarded without admin
smoke because the tester matrix was mobile-only.

**Example check (manual, pre-cutover):**
```bash
COLUMN="ai_approved"
for DIR in mingla-admin/src/ app-mobile/src/ supabase/functions/; do
  MATCHES=$(grep -rn "$COLUMN" "$DIR" | grep -vE '\.md$' || true)
  if [ -n "$MATCHES" ]; then
    echo "FAIL: $COLUMN still referenced in $DIR:"
    echo "$MATCHES"
    exit 1
  fi
done
```
```

---

## 8. Success criteria (10, exactly per dispatch)

| # | Criterion | Test |
|---|-----------|------|
| **SC-1** | All 6 RPCs free of `ai_approved` references post-migration | `SELECT proname FROM pg_proc WHERE proname IN (…6 names…) AND pg_get_functiondef(oid) ~ 'ai_approved'` returns 0 rows |
| **SC-2** | `admin_place_pool_city_list` body not touched (already clean per amendment) | Hash or byte-compare pre/post migration runs unchanged |
| **SC-3** | Place Pool page smoke: cities load, list view loads, map view loads, filter dropdown works across 3 states, Bouncer-Excluded tab loads without error | Manual browser test post-deploy |
| **SC-4** | Signal Library page smoke: cities load with non-zero servable counts, CityPipelineHistory shows non-zero `is_servable_count` (Hidden Flaw #2 fix) | Manual browser test post-deploy |
| **SC-5** | No `ai_approved` grep hits in the two edited JSX files | `grep -n 'ai_approved' mingla-admin/src/pages/PlacePoolManagementPage.jsx mingla-admin/src/pages/SignalLibraryPage.jsx` returns 0 lines |
| **SC-6** | No `aiCard` grep hits in PlacePoolManagementPage.jsx (dead-state deleted) | `grep -n 'aiCard' mingla-admin/src/pages/PlacePoolManagementPage.jsx` returns 0 lines |
| **SC-7** | Admin build exits 0 with no new errors | `cd mingla-admin && npm run build` — exit code 0 |
| **SC-8** | `handleApprove` no longer exists in PlacePoolManagementPage.jsx | `grep -n 'handleApprove' mingla-admin/src/pages/PlacePoolManagementPage.jsx` returns 0 lines |
| **SC-9** | CI invariant gate passes including new `mingla-admin/` scope | `./scripts/ci-check-invariants.sh` exit 0 |
| **SC-10** | Pre-flight verification gates 1-3 produced expected outputs before migration | Implementation report §1 documents gate results matching spec §2 expectations |

---

## 9. Invariants

### Preserved
| ID | How |
|----|-----|
| I-POOL-ONLY-SERVING | No new `card_pool` references introduced |
| I-BOUNCER-IS-QUALITY-GATE | `is_servable` is the only quality signal referenced; no admin override added |
| I-THREE-GATE-SERVING | Serving path not touched |
| Constitutional #1 | "Approve" button removal does not leave dead tap — removed entirely, not orphaned |
| Constitutional #2 | JSX field names align with DB column names (no more `ai_approved_X` when DB has `is_servable`) |
| Constitutional #3 | Silent zero on `SignalLibraryPage` row count (Hidden Flaw #2) fixed |
| Constitutional #8 | `aiCard` state + dead branches + `handleApprove` all deleted, not worked around |

### Established (NEW)
- **I-COLUMN-DROP-CLEANUP-EXHAUSTIVE** — see §7

---

## 10. Test cases (12)

| ID | Scenario | Input | Expected | Layer |
|----|----------|-------|----------|-------|
| T-01 | PlacePool page load | Admin opens page | Stats cards render; no error toast; overview + country + city tables populate | Full stack |
| T-02 | Signal Library load | Admin opens page | City picker populated; no "Couldn't load cities"; highest-servable-city auto-selected | Full stack |
| T-03 | Bouncer-Excluded tab | Click tab | Lists `is_servable=false` places; `bouncer_reason` visible per row; NO "Approve" button | JSX + DB |
| T-04 | Filter dropdown 3-state | Change each of Servable / Excluded / Not Yet Bounced | List re-queries correctly against `is_servable` TRUE / FALSE / NULL | JSX + DB |
| T-05 | Map view | Select a city | Pins render for `is_servable=true` only | JSX + DB |
| T-06 | Inline editor save | Open a place, change name + category, save | Succeeds; no dropped-column write errors | JSX + DB |
| T-07 | Bouncer status badge | Place with `is_servable=true`/`false`/`null` | Badge "Servable" (success) / "Excluded" (error) / "Not Yet Bounced" (outline) | JSX |
| T-08 | SignalLibrary pipeline row | Any seeded city with servable places | `StageCell done={N}` shows N > 0 (Hidden Flaw #2 verification) | JSX + RPC |
| T-09 | RPC smoke from DB | `SELECT * FROM admin_place_pool_overview(NULL, NULL)` | Row returned with correct 10 columns (new names); no errors | DB |
| T-10 | Pre-flight gates (before migration push) | Run the 3 SQL probes from spec §2 | GATE 1 = 0 rows; GATE 2 = 0 rows (ai_approved) + is_servable present; GATE 3 = all 6 RPCs present, has_stale_ref=true | DB |
| T-11 | Post-push RPC probe | `SELECT proname FROM pg_proc WHERE proname IN (…6…) AND pg_get_functiondef(oid) ~ 'ai_approved'` | 0 rows | DB |
| T-12 | CI invariant gate | `./scripts/ci-check-invariants.sh` | Exit 0 after fix; NEGATIVE-CONTROL: if you add a test `ai_approved` reference in `mingla-admin/src/pages/__test.jsx`, script exits 1 (prove new gate works) | CI |

---

## 11. Implementation order (9 steps)

1. **Pre-flight (mandatory):** Run §2 SQL probes. If any fails expected result → HALT and return to orchestrator.
2. **Migration:** Author `supabase/migrations/20260426000001_orch_0646_ai_approved_cleanup.sql` with the exact SQL in §3. DO NOT run `supabase db push` yet.
3. **JSX PlacePoolManagementPage.jsx:** Apply all 23 edits in §4 in order. Deletions (4.10, 4.11, 4.15, 4.16, 4.21 handleApprove block) BEFORE renames.
4. **JSX SignalLibraryPage.jsx:** Apply all 5 edits in §5.
5. **CI script:** Apply the one-line extension in §6.
6. **Invariant registry:** Append the I-COLUMN-DROP-CLEANUP-EXHAUSTIVE entry in §7.
7. **Code gates (all must exit 0 — NO SKIPPING):**
   - `cd mingla-admin && npm run build` → 0
   - `./scripts/ci-check-invariants.sh` → 0
   - `grep -n 'ai_approved' mingla-admin/src/pages/PlacePoolManagementPage.jsx mingla-admin/src/pages/SignalLibraryPage.jsx` → 0 lines
   - `grep -n 'aiCard' mingla-admin/src/pages/PlacePoolManagementPage.jsx` → 0 lines
   - `grep -n 'handleApprove' mingla-admin/src/pages/PlacePoolManagementPage.jsx` → 0 lines
8. **Produce commit-ready deploy sequence for user** (implementor writes the exact commands into the implementation report; DOES NOT execute them):
   ```bash
   # Deploy order (user-executed):
   cd supabase && supabase db push  # Applies the new migration
   # (Then reload admin in browser and run T-01 through T-08 smoke tests)
   # Admin build is deployed via existing admin CI/CD — no separate command if auto-deploy from main.
   # NO mobile OTA needed (mobile code not touched).
   ```
9. **Implementation report:** Write `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0646_AI_APPROVED_CLEANUP_REPORT.md` per template with: §2 pre-flight probe outputs, §4/§5 diff summary (files modified + line counts), §7 code-gate exit codes, commit message draft (plain, no Co-Authored-By line per memory), post-deploy smoke test checklist for user.

---

## 12. Commit message draft

Implementor produces this verbatim in the implementation report for user to copy:

```
fix(admin): ORCH-0646 — rewrite 6 admin RPCs + 28 JSX sites to use is_servable

ORCH-0640 dropped place_pool.ai_approved and rebuilt admin_place_pool_mv
without the column, but six admin RPCs and two admin pages still referenced
it. Place Pool and Signal Library pages were 500'ing in production.

DB:
  - DROP+CREATE admin_city_picker_data, admin_place_pool_overview,
    admin_place_country_overview, admin_place_city_overview
    (return-type changes: ai_approved_* → is_servable_*)
  - CREATE OR REPLACE admin_place_category_breakdown, admin_place_photo_stats
    (body-only: mv.ai_approved → mv.is_servable)

JSX:
  - PlacePoolManagementPage.jsx: 23 edits incl. delete aiCard state,
    delete handleApprove + approve button (D-3 read-only viewer),
    rename ai_approved → is_servable in select/eq/is/update sites,
    rename label copy throughout (AI Approved → Servable, etc.)
  - SignalLibraryPage.jsx: 5 edits incl. fix silent-zero from already-
    rewritten admin_city_pipeline_status (ai_approved_count → is_servable_count)

CI:
  - scripts/ci-check-invariants.sh: extend I-BOUNCER-IS-QUALITY-GATE grep
    to cover mingla-admin/src/

Invariants:
  - Register I-COLUMN-DROP-CLEANUP-EXHAUSTIVE (prevents recurrence)
  - Preserve I-POOL-ONLY-SERVING, I-BOUNCER-IS-QUALITY-GATE, I-THREE-GATE-SERVING

Deploy: supabase db push only. No mobile OTA. No edge fn redeploy.
```

---

## 13. Regression prevention

- **Structural:** CI gate extension in §6 ensures admin frontend is scanned on every push. Any future `ai_approved` reference in admin JSX fails CI.
- **Process:** I-COLUMN-DROP-CLEANUP-EXHAUSTIVE (§7) codifies the pre-cutover grep discipline.
- **Protective comment:** Added to the migration header at §3 pinning the why: "ORCH-0640 ch03 rebuilt MV without ai_approved; ch13 dropped column; ch05 rewrite missed these 6 — this migration completes cleanup."

---

## 14. Budget audit

- Spec length: ~500 lines (§3 SQL is ~300 lines; other sections compact).
- Expected implementor diff: +~300 migration lines; ~+20/-80 net JSX (heavy deletes from aiCard/handleApprove + AI Override block); +8/-5 CI script; +40 invariant registry. **Net ~+250 lines of code, ~-60 lines of dead code** — subtract-before-add preserved.

---

**END OF SPEC**

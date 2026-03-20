# Admin Pool Pipeline Audit — 2026-03-20

## Issue 1: seeding_cities RLS — INSERT blocked

**Root cause:** The migration (`20260320200000`) created only two policies:
- `service_role_all_seeding_cities` — allows ALL ops for service_role (edge functions only)
- `authenticated_read_seeding_cities` — allows SELECT for authenticated users

**Missing:** No INSERT/UPDATE/DELETE policy for authenticated admin users. The dashboard runs as `authenticated` (anon key + user session), not `service_role`. So any write to `seeding_cities` from the dashboard is blocked.

**Same gap likely exists on:** `seeding_tiles`, `seeding_operations`

**Fix:** New migration adding admin-gated write policies:
```sql
CREATE POLICY "admin_write_seeding_cities" ON public.seeding_cities
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.admin_users WHERE email = auth.email() AND status = 'active'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.admin_users WHERE email = auth.email() AND status = 'active'));
```

---

## Issue 2: seeding_category is blank — places pushed via search have no category

**Root cause:** Two pathways insert into `place_pool`:

| Pathway | Sets seeding_category? |
|---------|----------------------|
| **Seed pipeline** (`admin-seed-places?action=seed`) | YES — from the category config being seeded |
| **Manual push** (`admin-place-search?action=push`) | NO — `transformGooglePlace()` has no category field |

The `types` column stores raw Google Places types (e.g., `['restaurant', 'cafe', 'food']`) — these are NOT mapped to Mingla categories.

**Why Browse Pool filter by category shows nothing:** Places inserted via manual push have `seeding_category = NULL`. Filtering by any category excludes them. "All" shows them because no category filter is applied.

**Fix options:**
- A) Require category selection when pushing from search (modal with category picker)
- B) Auto-map Google types → Mingla categories using the mapping in `seedingCategories.ts`
- C) Both: auto-suggest based on types, let admin confirm/override

---

## Issue 3: Analytics — what exists vs. what's missing

### Currently exists:
- **User analytics** (AnalyticsPage.jsx): Growth, Engagement, Retention cohorts, Funnel, Geography — powered by 6 RPCs
- **Place pool stats** (PlacePoolManagementPage StatsTab): Per-city category breakdown, seeding history, spend tracking
- **Card pool stats** (CardPoolManagementPage): Per-city card counts, launch readiness checklist
- **Photo analytics** (PhotoPoolManagementPage): Coverage %, missing photos, backfill costs, weekly cost chart — powered by 5+ RPCs
- **Overview dashboard**: 8 stat cards with 7-day trends, alerts bar, recent activity

### High-value gaps (not surfaced):
1. **No cross-city comparison** — can't see all cities side-by-side
2. **No time-series trends** — only point-in-time snapshots, no "is freshness improving?"
3. **No seeding performance metrics** — success rate, cost per usable place, category yield
4. **No place quality scoring** — rating + reviews + photos + freshness + impressions = quality score
5. **No cost-per-outcome** — $ per place → $ per photo → $ per card → $ per impression
6. **No user↔content correlation** — can't answer "which categories do users in City A engage with?"
7. **No alerting** — admin must manually check; no threshold-breach notifications
8. **No drill-down navigation** — can't click from Growth chart to see which cities drive it
9. **No export** — most views lack CSV/JSON export
10. **No predictive insights** — no churn detection, cost forecasting, or launch ETA

### DB tables available but not fully leveraged:
- `seeding_operations` — full audit trail with costs, success/fail counts, error details
- `user_card_impressions` — card view counts (could power engagement quality scoring)
- `place_admin_actions` — admin action audit trail
- `user_sessions` + `user_interactions` — full behavior data
- `admin_backfill_log` — photo download operation history

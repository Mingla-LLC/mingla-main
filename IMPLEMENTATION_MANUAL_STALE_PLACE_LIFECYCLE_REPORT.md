# Implementation Report: Manual Stale-Place Lifecycle

## 1. What Was There Before

- `deactivate_stale_places()` SQL function existed — automatically set `is_active = false` on places older than 7 days with 3+ failures, cascading to cards. Not scheduled but callable by anyone.
- `refresh-place-pool` edge function was deprecated (returns no-op).
- `admin_trigger_place_refresh()` RPC existed (creates pending backfill log entries) but no edge function processed them.
- `admin_pool_stats_overview()` computed refresh_health stats (stale_7d, stale_30d, recently_served_and_stale).
- PhotoPoolManagementPage had refresh UI with trigger buttons (non-functional without execution layer).
- PlacePoolBuilderPage had Browse Pool with per-place toggle/refresh via `admin-place-search` edge function.
- No separation between "stale" (needs review) and "inactive" (admin removed). Both used `is_active`.
- No audit trail for deactivate/reactivate actions on places.

## 2. What Changed

### A. Migration (`20260319100000_manual_stale_place_lifecycle.sql`)

| Change | Detail |
|--------|--------|
| **Dropped** `deactivate_stale_places()` | Removed the automatic deactivation function entirely |
| **Created** `v_stale_places` view | Computed view — staleness calculated on-the-fly, never stored. Computes `staleness_tier` (fresh/stale/warning/critical), `stale_reason`, `recently_served` flag. Never touches `is_active`. |
| **Created** `place_admin_actions` table | Audit table: `place_id`, `action_type`, `acted_by`, `acted_at`, `reason`, `metadata`. RLS: service_role full, admins read+insert. |
| **Created** `admin_list_stale_places()` | Paginated RPC with filters (all/active_only/inactive_only/recently_served/critical), sorting (staleness/failures/name/recently_served), summary stats, last admin action per place. |
| **Created** `admin_deactivate_place()` | Sets `is_active = false`, cascades to cards, logs to `place_admin_actions` with reason. |
| **Created** `admin_reactivate_place()` | Sets `is_active = true`, reactivates linked cards, logs to `place_admin_actions` with reason. |
| **Created** `admin_bulk_deactivate_places()` | Bulk deactivation with per-place audit logging. |

### B. Edge Function (`admin-refresh-places/index.ts`)

- **NEW**: Processes pending `place_refresh` backfill log entries by calling Google Places API (Place Details).
- Two modes: `process` (batch from backfill log) and `refresh_single` (one place by UUID).
- Updates place data, resets `refresh_failures` to 0 on success, increments on failure.
- Logs each refresh to `place_admin_actions` audit table.
- Rate-limited: 50ms delay between API calls.
- Updates backfill log with success/failure counts, cost, and error details.

### C. Admin UI (PlacePoolBuilderPage — new "Stale Review" tab)

- **Summary stats**: Total stale, active & stale, critical (>30d), served & stale.
- **Batch actions**: "Refresh Recently Served" and "Refresh All Stale" buttons with cost awareness.
- **Filterable table**: 5 filter options, 4 sort options, paginated.
- **Per-place actions**: Refresh, Deactivate (with reason modal), Reactivate (with reason modal).
- **Bulk deactivation**: Select multiple → deactivate with audit trail.
- **Reason modal**: Optional reason text captured and stored in audit table.

### D. Audit Log Labels (`auditLog.js`)

Added 5 new action labels: `place.stale_deactivate`, `place.stale_reactivate`, `place.stale_bulk_deactivate`, `place.batch_refresh`, `place.refresh_single`.

## 3. Policy Compliance

| Requirement | Status |
|-------------|--------|
| No automated deactivation | PASS — `deactivate_stale_places()` dropped |
| No pg_cron / scheduled functions | PASS — no schedulers added |
| No automatic refresh | PASS — refresh only via admin-triggered edge function |
| Preserve stale signals (refresh_failures, last_detail_refresh) | PASS — untouched |
| Stale places exposed for admin review | PASS — `v_stale_places` view + `admin_list_stale_places()` RPC + UI tab |
| Admin can list/refresh/deactivate/reactivate | PASS — all four RPCs + edge function + UI |
| Stale ≠ inactive separation | PASS — staleness is computed (view), `is_active` is operational (column) |
| Audit trail (acted_by, acted_at, reason) | PASS — `place_admin_actions` table |
| No automatic is_active mutation | PASS — only admin RPCs change is_active |

## 4. Files Inventory

### Created
- `supabase/migrations/20260319100000_manual_stale_place_lifecycle.sql`
- `supabase/functions/admin-refresh-places/index.ts`

### Modified
- `mingla-admin/src/pages/PlacePoolBuilderPage.jsx` — added Stale Review tab
- `mingla-admin/src/lib/auditLog.js` — added 5 new action labels

## 5. Verification Checklist

- [ ] Run migration on Supabase — confirm `deactivate_stale_places()` is gone
- [ ] Confirm `v_stale_places` view returns computed staleness for test places
- [ ] Call `admin_list_stale_places()` via SQL — verify pagination and filters
- [ ] Call `admin_deactivate_place()` — verify `is_active` flips, cards cascade, audit row created
- [ ] Call `admin_reactivate_place()` — verify reverse cascade and audit
- [ ] Deploy `admin-refresh-places` edge function
- [ ] Test `refresh_single` action — verify Google API call, place data updated, failures reset
- [ ] Test `process` action — verify backfill log transitions pending → running → completed
- [ ] Open Place Pool Builder → Stale Review tab — verify stats, table, filters, sort
- [ ] Deactivate a place from Stale Review — verify reason modal, audit entry
- [ ] Reactivate a place — verify reason modal, audit entry
- [ ] Batch refresh — verify cost display, backfill log creation, edge function execution
- [ ] Check admin_audit_log for new action labels in Recent Activity

## 6. Known Limitations

- **Batch refresh is synchronous**: Large batches (500 places) will take time. Consider adding progress polling UI in a future iteration.
- **View performance**: `v_stale_places` computes `recently_served` via subquery on each row. At scale (10K+ stale places), consider materializing or adding an index. Currently fine for expected pool sizes.
- **No webhook/notification**: Admin must manually check the Stale Review tab. No push notification when critical stale places appear.

## 7. Deviations from Spec

None. All 9 requirements implemented as specified.

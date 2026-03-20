# Test Report: Manual Stale-Place Lifecycle
**Date:** 2026-03-19
**Implementation:** IMPLEMENTATION_MANUAL_STALE_PLACE_LIFECYCLE_REPORT.md
**Tester:** Brutal Tester Skill
**Verdict:** 🟡 CONDITIONAL PASS

---

## Executive Summary

Solid implementation overall — the migration is well-structured, the edge function handles errors properly, and the admin UI is thorough with proper mounted guards and reason modals. However, there are **2 critical findings** (one security, one data integrity), **3 high findings**, and **5 medium findings** that need attention before merge.

---

## Test Manifest

| Category | Items Tested | Passed | Failed | Warnings |
|----------|-------------|--------|--------|----------|
| TypeScript Compliance | 5 | 5 | 0 | 0 |
| Pattern Compliance | 8 | 6 | 0 | 2 |
| Security | 7 | 5 | 2 | 0 |
| Google Places API | 6 | 6 | 0 | 0 |
| Edge Functions | 8 | 6 | 1 | 1 |
| Database & RLS | 10 | 8 | 1 | 1 |
| Admin UI | 12 | 10 | 0 | 2 |
| Cross-Domain Impact | 4 | 4 | 0 | 0 |
| **TOTAL** | **60** | **50** | **4** | **6** |

---

## 🔴 Critical Findings (Must Fix Before Merge)

### CRIT-001: Edge Function Uses Service Role Key for ALL Operations — Bypasses RLS

**File:** `supabase/functions/admin-refresh-places/index.ts` (line 260)
**Category:** Security

**What's Wrong:**
The Supabase client is created with `SUPABASE_SERVICE_ROLE_KEY` on every request:
```typescript
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
```
Then the user's JWT is verified via `supabase.auth.getUser(token)` and admin status is checked manually. This is **correct** for this use case — the function needs service_role to update `place_pool` (which has user-scoped RLS), and it manually verifies admin status.

**However**, the admin check queries `admin_users` by `user.email`:
```typescript
const { data: adminRow } = await supabase
  .from("admin_users")
  .select("id")
  .eq("email", user.email)
  .eq("status", "active")
  .maybeSingle();
```

The `user.email` field from `supabase.auth.getUser()` is the **user's email from their auth profile**, which they can change. If a user changes their auth email to match an admin's email, they would pass this check.

**Required Fix:**
Use `user.id` instead of `user.email` for the admin check. The `admin_users` table has an `id` column that should reference `auth.users(id)`. Check if `admin_users` has a `user_id` FK, or compare by a non-mutable field. Alternatively, cross-reference with the same pattern `is_admin_user()` uses — which also checks by email. If email is the canonical admin identifier (no user_id FK), then this is the same trust level as the RPCs and this finding downgrades to **accepted risk**, but it should be documented.

**Why This Matters:**
Potential privilege escalation if a regular user can modify their email to match an admin's email in the auth system.

**Severity Reassessment:** After checking that `is_admin_user()` also checks by email (confirmed), this is **consistent with the existing security model**. The RPCs use the same pattern. Downgrade to **accepted risk** — but note that the entire admin auth model trusts email identity. This is a pre-existing architectural concern, not introduced by this implementation.

**REVISED SEVERITY: 🟠 HIGH (pre-existing pattern, not a regression)**

---

### CRIT-002: Bulk Deactivate Audit Logs Inserted for ALL Requested IDs, Not Just Successfully Deactivated Ones

**File:** `supabase/migrations/20260319100000_manual_stale_place_lifecycle.sql` (lines 393-397)
**Category:** Data Integrity

**What's Wrong:**
```sql
FOREACH v_pid IN ARRAY p_place_ids LOOP
  INSERT INTO place_admin_actions (place_id, action_type, acted_by, reason, metadata)
  VALUES (v_pid, 'bulk_deactivate', v_user_id, p_reason,
    jsonb_build_object('batch_size', array_length(p_place_ids, 1)));
END LOOP;
```

The audit log iterates over ALL `p_place_ids` — including IDs that were already inactive (and thus skipped by the UPDATE). This creates phantom audit entries for places that weren't actually changed.

If you pass 10 place IDs but only 6 were active, you get 10 audit rows but `places_deactivated = 6`.

**Required Fix:**
Only insert audit rows for places that were actually deactivated. Use the `RETURNING` clause result:
```sql
WITH deactivated AS (
  UPDATE place_pool SET is_active = false, updated_at = now()
  WHERE id = ANY(p_place_ids) AND is_active = true
  RETURNING id
)
-- Use deactivated IDs for audit
INSERT INTO place_admin_actions (place_id, action_type, acted_by, reason, metadata)
SELECT id, 'bulk_deactivate', v_user_id, p_reason,
  jsonb_build_object('batch_size', (SELECT COUNT(*) FROM deactivated))
FROM deactivated;
```

**Why This Matters:**
Phantom audit entries make the audit trail unreliable. An admin reviewing the log would see "bulk_deactivate" for a place that was already inactive — misleading and potentially causing confusion during incident investigation.

---

## 🟠 High Findings (Should Fix Before Merge)

### HIGH-001: `place_pool.updated_at` Set Manually AND by Trigger — Double Update

**File:** `supabase/migrations/20260319100000_manual_stale_place_lifecycle.sql` (lines 259, 319, 379)
**Category:** Redundancy / Potential Confusion

**What's Wrong:**
The RPCs manually set `updated_at = now()`:
```sql
UPDATE place_pool SET is_active = false, updated_at = now()
```
But from the exploration, `place_pool` already has an `update_updated_at_column()` trigger that fires on UPDATE and sets `updated_at = now()` automatically.

This is harmless (same value), but it's a pattern violation — other code in the repo relies on the trigger. Manual `updated_at` setting signals to future developers that triggers don't exist or can't be trusted.

**Required Fix:**
Remove `updated_at = now()` from all three UPDATE statements in the RPCs. The trigger handles it.

**Why This Matters:**
Pattern inconsistency leads to confusion. If someone later removes the trigger thinking "RPCs handle it manually," or adds a trigger thinking "nothing sets it manually," both paths create bugs.

---

### HIGH-002: Edge Function `refreshPlace()` Updates by `google_place_id` Without Checking Success

**File:** `supabase/functions/admin-refresh-places/index.ts` (lines 82-106)
**Category:** Silent Failure

**What's Wrong:**
The update call doesn't check for errors:
```typescript
await supabase
  .from("place_pool")
  .update({ /* ... */ })
  .eq("google_place_id", googlePlaceId);
// No error check!
```

If the Supabase update fails (e.g., RLS denial, constraint violation, network timeout), the function still returns `{ success: true }`. The Google API call succeeded but the data was never persisted.

Similarly, the failure path (lines 58-70) also doesn't check the update result.

**Required Fix:**
Check for errors on both update calls:
```typescript
const { error: updateError } = await supabase
  .from("place_pool")
  .update({ /* ... */ })
  .eq("google_place_id", googlePlaceId);

if (updateError) {
  return { success: false, error: `DB update failed: ${updateError.message}` };
}
```

**Why This Matters:**
A "successful" refresh that didn't actually persist data means stale data remains but the admin thinks it's fixed. The place disappears from the stale list (if `last_detail_refresh` happened to update via a different path), but the actual data is still old.

---

### HIGH-003: Summary Stats in `admin_list_stale_places()` Are Computed Independently of Filter — Performance Concern

**File:** `supabase/migrations/20260319100000_manual_stale_place_lifecycle.sql` (lines 211-217)
**Category:** Performance

**What's Wrong:**
```sql
'summary', jsonb_build_object(
  'total_stale', v_total,
  'active_stale', (SELECT COUNT(*) FROM v_stale_places WHERE is_active = true),
  'inactive_stale', (SELECT COUNT(*) FROM v_stale_places WHERE is_active = false),
  'recently_served_stale', (SELECT COUNT(*) FROM v_stale_places WHERE recently_served = true),
  'critical_count', (SELECT COUNT(*) FROM v_stale_places WHERE staleness_tier = 'critical')
)
```

Each `COUNT(*)` rescans the `v_stale_places` view independently. The view contains a correlated `EXISTS` subquery on `card_pool` + `user_card_impressions` for `recently_served`. That's **5 separate view evaluations** per RPC call.

At the implementation report's own estimated scale concern (10K+ stale places), this means 5 full scans of the view, each executing the correlated subquery.

**Required Fix:**
Compute all summary stats in a single pass:
```sql
SELECT
  COUNT(*) AS total_stale,
  COUNT(*) FILTER (WHERE is_active = true) AS active_stale,
  COUNT(*) FILTER (WHERE is_active = false) AS inactive_stale,
  COUNT(*) FILTER (WHERE recently_served = true) AS recently_served_stale,
  COUNT(*) FILTER (WHERE staleness_tier = 'critical') AS critical_count
INTO v_total, v_active, v_inactive, v_served, v_critical
FROM v_stale_places;
```

Then use `v_total` for the count query result too (note: `v_total` currently holds the *filtered* count, not the total — so you'd need a separate variable for the filtered count). This reduces 6 view scans (1 for count + 4 for summary + 1 for data) to 2 (1 summary + 1 for data).

**Why This Matters:**
Each view scan re-evaluates the `recently_served` EXISTS subquery. With 10K stale places × 5 scans, that's 50K subquery evaluations when 10K would suffice.

---

## 🟡 Medium Findings (Fix Soon)

### MED-001: `v_stale_places` View Includes `fresh` in `staleness_tier` But WHERE Clause Excludes Fresh Places

**File:** `supabase/migrations/20260319100000_manual_stale_place_lifecycle.sql` (lines 40-44 vs 61-62)
**Category:** Dead Code / Confusion

**What's Wrong:**
The CASE statement includes `ELSE 'fresh'` for `staleness_tier`, but the WHERE clause filters to only places where `last_detail_refresh < now() - interval '7 days' OR refresh_failures >= 3`. A place can only have `staleness_tier = 'fresh'` if it has `refresh_failures >= 3` but was refreshed within 7 days — unusual but possible.

Similarly, `stale_reason` has `ELSE 'fresh'` which would trigger for a place with `refresh_failures >= 3` that refreshed recently — but the `stale_reason` would be `'failing_refreshes'` (caught earlier in the CASE), not `'fresh'`. So `stale_reason = 'fresh'` is truly unreachable.

**Required Fix:**
Change the `ELSE 'fresh'` in `stale_reason` to something explicit like `ELSE 'unknown'` or remove it (it's unreachable). The `staleness_tier` ELSE is technically reachable (failures ≥ 3 + fresh refresh), so that's fine — but document the case.

**Why This Matters:**
Minor — but a future developer might rely on `staleness_tier` never being `'fresh'` in this view, then get surprised.

---

### MED-002: Stale Review UI — `handleTriggerBatchRefresh` Calls `admin_trigger_place_refresh` RPC Then Immediately Executes

**File:** `mingla-admin/src/pages/PlacePoolBuilderPage.jsx` (lines 1011-1050)
**Category:** Race Condition / UX

**What's Wrong:**
The flow is:
1. Call `admin_trigger_place_refresh` RPC → creates pending backfill log entry
2. Immediately call `admin-refresh-places` edge function with `action: "process"`

If the RPC and edge function are on different database connections (they are — RPC is via Supabase client, edge function creates its own), there's a potential race where the edge function's `SELECT ... WHERE status = 'pending'` runs before the RPC's INSERT has committed and become visible.

In practice, Supabase RPCs are synchronous and commit before returning, so the `await` should ensure ordering. But under load or with connection pooling, this is fragile.

**Required Fix:**
The edge function should accept the `backfill_log_id` directly instead of querying for pending entries:
```json
{ "action": "process", "backfillLogId": triggerResult.backfill_log_id }
```
This eliminates the race entirely.

**Why This Matters:**
If the race triggers, the edge function returns `"nothing_to_do"` even though a job was just queued. Admin thinks refresh failed.

---

### MED-003: Inline Styles in Map Popup (Leaflet)

**File:** `mingla-admin/src/pages/PlacePoolBuilderPage.jsx` (lines 424-441)
**Category:** Pattern Violation

**What's Wrong:**
The Leaflet Popup content uses inline `style={{}}` objects:
```jsx
<span style={{ fontSize: 12, color: "#666" }}>
```
And hardcoded hex colors instead of CSS variables. This is a pre-existing pattern in the Search & Import tab (not introduced by this implementation), but the Stale Review tab doesn't have this issue.

**Required Fix:**
This is pre-existing — no action required for this implementation. Note for future cleanup.

**REVISED: Not a finding against this implementation. Removed from scope.**

---

### MED-003 (revised): Admin UI Deactivate/Reactivate in Browse Tab Doesn't Use Audit RPCs

**File:** `mingla-admin/src/pages/PlacePoolBuilderPage.jsx` (lines 584-623)
**Category:** Inconsistency / Audit Gap

**What's Wrong:**
The Browse Pool tab's `handleToggleActive` and `confirmDeactivate` functions directly update `place_pool` via Supabase client:
```javascript
await supabase.from("place_pool").update({ is_active: false }).eq("id", row.id);
```
This bypasses the new `admin_deactivate_place()` / `admin_reactivate_place()` RPCs, which:
- Cascade to cards
- Log to `place_admin_actions` audit table
- Return structured results

The Browse tab only logs to `admin_audit_log` (the old audit system), doesn't cascade to cards, and doesn't log to `place_admin_actions`.

**Required Fix:**
Update Browse tab's toggle/deactivate to use the same RPCs the Stale Review tab uses:
```javascript
const { data: result, error } = await supabase.rpc("admin_deactivate_place", {
  p_place_id: row.id,
  p_reason: null,
});
```

**Why This Matters:**
Two different code paths for the same operation = two different behaviors. Deactivating via Browse doesn't cascade to cards (leaving orphaned active cards pointing to an inactive place). Deactivating via Stale Review does cascade. This will cause data inconsistency.

**SEVERITY UPGRADE: This is actually 🔴 Critical — orphaned active cards pointing to inactive places will be served to users.**

---

### MED-004: Edge Function Doesn't Log to `place_admin_actions` on Refresh Failure

**File:** `supabase/functions/admin-refresh-places/index.ts` (lines 178-181)
**Category:** Incomplete Audit Trail

**What's Wrong:**
On success, the edge function logs to `place_admin_actions`:
```typescript
if (result.success) {
  await supabase.from("place_admin_actions").insert({ ... });
} else {
  failureCount++;
  errors.push({ ... });
}
```
Failed refreshes are only counted — not audited. An admin investigating a problematic place won't see failed refresh attempts in the audit trail.

**Required Fix:**
Log failed refreshes too:
```typescript
await supabase.from("place_admin_actions").insert({
  place_id: place.id,
  action_type: "refresh",
  acted_by: adminUserId,
  metadata: { backfill_log_id: logEntry.id, result: "failed", error: result.error },
});
```

**Why This Matters:**
Audit trail should capture attempts, not just successes. If a place keeps failing refresh, the admin needs to see the history.

---

### MED-005: `admin_list_stale_places` Summary's `total_stale` Uses `v_total` (Filtered Count), Not Actual Total

**File:** `supabase/migrations/20260319100000_manual_stale_place_lifecycle.sql` (line 212)
**Category:** Misleading Data

**What's Wrong:**
```sql
'total_stale', v_total,
```
`v_total` is the count of places matching the current `p_filter`. When `p_filter = 'active_only'`, `total_stale` equals `active_stale`. The UI summary stats card shows `summary.total_stale` as "Total Stale" — but it changes based on the active filter, which is confusing.

**Required Fix:**
Add a separate total count that ignores the filter:
```sql
'total_stale', (SELECT COUNT(*) FROM v_stale_places),
```
And use `v_total` for pagination metadata only.

**Why This Matters:**
Admin sees "Total Stale: 45" with "Active Only" filter, switches to "All Stale" and sees "Total Stale: 72". The "total" isn't total — it's filtered. Misleading for decision-making.

---

## ✅ What Passed

### Things Done Right
1. **View-based staleness detection** — Computing staleness on-the-fly via `v_stale_places` instead of storing it is architecturally correct. No stale-staleness.
2. **Audit table design** — `place_admin_actions` with proper FK, RLS, indexes, and metadata JSONB is well-designed.
3. **SECURITY DEFINER + `is_admin_user()` check** — All RPCs properly guard admin access.
4. **`mounted` ref pattern** — All async operations in the UI are guarded against unmount state updates. Consistent with existing admin patterns.
5. **Reason modal UX** — Optional reason text for deactivate/reactivate is a strong audit feature.
6. **CORS handling** — Edge function properly handles OPTIONS and includes CORS headers on all responses.
7. **Google Places API compliance** — Uses correct New Places API endpoint, `X-Goog-Api-Key` header, `X-Goog-FieldMask` header with appropriate field list. No legacy API usage.
8. **Price level mapping** — Correctly maps enum strings (`PRICE_LEVEL_MODERATE`) to Mingla's tier system.
9. **Idempotent migration** — Uses `CREATE TABLE IF NOT EXISTS`, `CREATE OR REPLACE`, `DROP FUNCTION IF EXISTS`.
10. **No cross-domain breakage** — Mobile doesn't read `place_pool` directly; all changes are backend-safe.

### Passing Checks

| Check | Status |
|-------|--------|
| TypeScript strict (no `any`, no `@ts-ignore`) | ✅ |
| Deno imports pinned (`@0.168.0`, `@2`) | ✅ |
| RLS on `place_admin_actions` | ✅ |
| Foreign keys with CASCADE | ✅ |
| TIMESTAMPTZ for timestamps | ✅ |
| UUID for IDs with `gen_random_uuid()` | ✅ |
| NOT NULL on required fields | ✅ |
| Indexes on query columns | ✅ |
| CORS headers on success AND error | ✅ |
| Content-Type: application/json | ✅ |
| Edge function input validation | ✅ |
| Error response shape `{ error: string }` | ✅ |
| CSS variables (no hardcoded colors in new code) | ✅ |
| Existing UI component reuse (Badge, Button, Modal, DataTable) | ✅ |
| Dark mode safe (CSS variables throughout) | ✅ |
| Admin auth guard (via RPC SECURITY DEFINER) | ✅ |
| No API keys in frontend code | ✅ |
| No direct third-party API calls from frontend | ✅ |

---

## Spec Compliance Matrix

| Requirement (from Implementation Report §3) | Met? | Evidence |
|----------------------------------------------|------|----------|
| No automated deactivation | ✅ | `deactivate_stale_places()` dropped |
| No pg_cron / scheduled functions | ✅ | No cron references added |
| No automatic refresh | ✅ | Refresh only via admin action |
| Preserve stale signals | ✅ | `refresh_failures`, `last_detail_refresh` untouched by migration |
| Stale places exposed for admin review | ✅ | View + RPC + UI tab |
| Admin can list/refresh/deactivate/reactivate | ✅ | All four operations present |
| Stale ≠ inactive separation | ✅ | View computes staleness, `is_active` is operational |
| Audit trail (acted_by, acted_at, reason) | ✅ | `place_admin_actions` table |
| No automatic `is_active` mutation | ✅ | Only RPCs change `is_active` |

---

## Implementation Report Verification

| Implementor's Claim | Verified? | Accurate? | Notes |
|---------------------|-----------|-----------|-------|
| Dropped `deactivate_stale_places()` | ✅ | ✅ | `DROP FUNCTION IF EXISTS` present |
| Created `v_stale_places` view | ✅ | ✅ | Correct computed view, never mutates |
| Created `place_admin_actions` table | ✅ | ✅ | Proper schema with RLS |
| Created `admin_list_stale_places()` RPC | ✅ | ✅ | Paginated, filtered, sorted |
| Created `admin_deactivate_place()` RPC | ✅ | ✅ | Cascades to cards, logs audit |
| Created `admin_reactivate_place()` RPC | ✅ | ✅ | Cascades to cards, logs audit |
| Created `admin_bulk_deactivate_places()` RPC | ✅ | 🟡 | Works but audit logs are over-counted (CRIT-002) |
| Created `admin-refresh-places` edge function | ✅ | ✅ | Two modes, Google API, audit logging |
| Added Stale Review tab to PlacePoolBuilderPage | ✅ | ✅ | Full tab with stats, table, actions |
| Added 5 audit labels to auditLog.js | ✅ | ✅ | All 5 present and correctly labeled |
| "No deviations from spec" | ❌ | ❌ | Browse tab bypass (MED-003r) is a deviation from "all deactivation goes through RPCs" |

---

## Recommendations

### Mandatory (block merge)
1. **CRIT-002**: Fix bulk deactivate audit to only log actually-deactivated places
2. **MED-003r** (upgraded to CRIT): Update Browse tab deactivate/reactivate to use the new RPCs — current code bypasses card cascade and `place_admin_actions` audit

### Strongly Recommended (merge at your own risk)
3. **HIGH-002**: Add error checking on Supabase update calls in `refreshPlace()`
4. **HIGH-003**: Optimize summary stats to single-pass query
5. **HIGH-001**: Remove manual `updated_at = now()` from RPCs (trigger handles it)

### Should Fix Soon
6. **MED-002**: Pass `backfillLogId` to edge function instead of querying for pending
7. **MED-004**: Log failed refreshes to audit table
8. **MED-005**: Fix `total_stale` to always show unfiltered total

### Technical Debt to Track
- Admin auth model trusts email identity across the board (pre-existing, not a regression)
- `v_stale_places` correlated subquery will need optimization at scale (acknowledged in implementation report)

---

## Verdict Justification

**🟡 CONDITIONAL PASS** — The core architecture is sound (view-based staleness, audit table, admin RPCs, edge function). The implementation is well-structured and follows existing patterns. However, **2 critical issues** must be resolved:

1. The Browse tab's deactivate bypasses the new RPCs, creating orphaned active cards (data integrity risk)
2. Bulk deactivate audit logs are over-counted (audit reliability)

Both are straightforward fixes (swap direct Supabase calls for RPC calls; use RETURNING clause for audit). After these two fixes, this is a clean **🟢 PASS** without needing another full test pass — the fixes are mechanical and low-risk.

# Test Report: Admin Dashboard 4-Fix Bundle
**Date:** 2026-03-20
**Implementation:** `outputs/IMPLEMENTATION_ADMIN_DASHBOARD_FIXES.md`
**Tester:** Brutal Tester Skill
**Verdict:** 🟢 PASS

---

## Executive Summary

Four admin dashboard fixes audited: SeedPage crash, Users page infinite loading, beta toggle wiring, and subscription 400 errors. All four fixes are correct, well-targeted, and introduce no regressions. Two new SQL migrations are clean, idempotent, and security-guarded. One minor inconsistency found (medium severity) that does not block merge.

---

## Test Manifest

Total items tested: 38
| Category | Items Tested | Passed | Failed | Warnings |
|----------|-------------|--------|--------|----------|
| Pattern Compliance | 6 | 6 | 0 | 0 |
| Security | 8 | 8 | 0 | 0 |
| Database & RLS | 10 | 10 | 0 | 0 |
| Cross-Domain Impact | 4 | 4 | 0 | 0 |
| Admin Dashboard Audit | 6 | 6 | 0 | 0 |
| Implementation Claims | 4 | 3 | 0 | 1 |
| **TOTAL** | **38** | **37** | **0** | **1** |

---

## 🔴 Critical Findings

None.

---

## 🟠 High Findings

None.

---

## 🟡 Medium Findings

### MED-001: Expiring Overrides JS Query Missing `starts_at` Guard
**File:** `mingla-admin/src/pages/SubscriptionManagementPage.jsx` (lines 212–219)
**Category:** Data consistency
**What's Wrong:**
The frontend "expiring overrides" query checks:
```javascript
.is("revoked_at", null)
.gt("expires_at", new Date().toISOString())
.lt("expires_at", threeDaysFromNow)
```
But the fixed RPC `admin_subscription_stats()` uses:
```sql
WHERE revoked_at IS NULL AND starts_at <= now() AND expires_at > now()
```
The JS query is missing `starts_at <= now()`. If an override is created with a future `starts_at`, it would be counted by the JS banner but not by the RPC stats card.

**Practical Impact:** LOW — The `admin_grant_override` RPC defaults `starts_at` to `now()`, so future-dated starts don't currently happen. This is a theoretical edge case.

**Recommended Fix (optional):**
Add `.lte("starts_at", new Date().toISOString())` to the query for consistency.

**Why This Matters:** If future-dated overrides are ever supported (e.g., "schedule a Pro grant starting next Monday"), the banner count would be wrong.

---

## ✅ What Passed

### Fix 1: SeedPage Crash — PASS
- **Verified:** `useAuth` import added at line 13 of `SeedPage.jsx`
- **Verified:** `useAuth()` destructured at line 20 (`const { session } = useAuth()`)
- **Pattern check:** Import ordering matches adjacent pages (React hooks → lucide → supabase → components → context → lib)
- **`mountedRef` guard:** Already present at lines 21-22 — correct pattern
- **No other issues found** — SeedPage is clean, well-structured

### Fix 2: Admin RLS Bypass Policies — PASS
- **Verified:** `is_admin_user()` function exists in migration `20260317100001`, checks `admin_users` table with `SECURITY DEFINER`
- **Verified:** SELECT policy uses `USING (is_admin_user())` — correct for read bypass
- **Verified:** UPDATE policy uses both `USING (is_admin_user())` AND `WITH CHECK (is_admin_user())` — correct
- **Verified:** `DROP POLICY IF EXISTS` before `CREATE POLICY` — idempotent ✅
- **Verified:** No `IF NOT EXISTS` needed for policies (Postgres doesn't support it; DROP+CREATE is the standard pattern)
- **Cross-domain impact:** PostgreSQL OR's all matching policies for a given operation. The existing "Profiles viewable except by blocked users" policy remains active for non-admin users. Admin users short-circuit to the fast admin policy, bypassing the expensive `is_blocked_by()` per-row check. Normal user behavior is unchanged. ✅
- **Mobile impact:** Mobile users authenticate via JWT with normal user IDs. `is_admin_user()` returns false for them → they hit existing policies. No regression. ✅

### Fix 3: Beta Toggle Wiring — PASS
All 6 edit locations verified:

| Edit | Location | Status |
|------|----------|--------|
| SELECT column | Line 203 — `is_beta_tester` in query string | ✅ |
| List table column | Lines 870-878 — Beta column after Status, shows `<Badge variant="brand">Beta</Badge>` when true, "—" when false | ✅ |
| Detail header badge | Lines 1140-1142 — `{userDetail.is_beta_tester && <Badge variant="brand">Beta Tester</Badge>}` | ✅ |
| Detail read-only field | Line 1209 — `ProfileField` with `value={userDetail.is_beta_tester ? "Yes" : "No"}` | ✅ |
| Edit form checkbox | Lines 1189-1192 — Checkbox with `checked={editForm.is_beta_tester ?? false}` | ✅ |
| Save handler | Line 528 — `is_beta_tester: editForm.is_beta_tester` in updates object | ✅ |

- **Column exists:** Confirmed in migration `20260316000005_add_beta_tester_admin_flags.sql` — `BOOLEAN NOT NULL DEFAULT false`
- **Pattern compliance:** Checkbox follows exact same pattern as "Has Completed Onboarding" and "Active" checkboxes on lines 1182-1187 ✅
- **Badge follows existing patterns:** Uses `variant="brand"` consistent with other feature badges in the codebase ✅

### Fix 4: Subscription 400 Errors — PASS
- **Root cause confirmed:** `admin_subscription_overrides` table schema has NO `status` or `is_active` column. Active state is derived from `revoked_at IS NULL AND starts_at <= now() AND expires_at > now()`.
- **RPC fix verified:** `20260320000002_fix_admin_subscription_stats.sql` correctly replaces `WHERE status = 'active'` with `WHERE revoked_at IS NULL AND starts_at <= now() AND expires_at > now()` in both the `overrides` and `expiring_soon` subqueries ✅
- **Frontend fix verified:** The expiring overrides query at lines 214-219 correctly uses `.is("revoked_at", null).gt("expires_at", now).lt("expires_at", threeDaysFromNow)` ✅
- **`SECURITY DEFINER` preserved:** Function still runs with definer privileges ✅
- **`is_admin_user()` guard preserved:** Line 8 still checks admin authorization ✅
- **`CREATE OR REPLACE`:** Idempotent — safe to re-run ✅

### Things Done Right
1. **Root cause analysis was accurate** — Each fix correctly identified the actual issue (missing import, slow RLS policy, missing column in SELECT, non-existent column in WHERE)
2. **Minimal, targeted changes** — No unnecessary refactoring or scope creep. Each fix touches exactly what needed to change.
3. **Migration idempotency** — Both migrations use `DROP IF EXISTS` + `CREATE` or `CREATE OR REPLACE`. Safe to run multiple times.
4. **Security discipline** — Admin RLS policies use `is_admin_user()` (which checks `admin_users` table), not a blanket `true` or role check. WITH CHECK present on UPDATE policy.
5. **Pattern consistency** — Beta toggle wiring follows the exact same patterns used by existing checkboxes, badges, and profile fields in the same file.

---

## Security Audit

| Check | Result | Notes |
|-------|--------|-------|
| Admin RLS not overly permissive | ✅ PASS | Uses `is_admin_user()`, not `true` or `current_setting('role') = 'service_role'` |
| UPDATE policy has WITH CHECK | ✅ PASS | Prevents admin impersonation by requiring admin check on write too |
| SECURITY DEFINER on stats RPC | ✅ PASS | Function has its own `is_admin_user()` guard before any queries |
| No API keys exposed | ✅ PASS | No new API keys or secrets introduced |
| No SQL injection vectors | ✅ PASS | All queries use parameterized Supabase client or PL/pgSQL variables |
| No XSS vectors | ✅ PASS | All new UI elements use React JSX (auto-escaped), no `dangerouslySetInnerHTML` |
| Cross-domain RLS safety | ✅ PASS | New policies are additive (OR'd), don't weaken existing mobile-user policies |
| Auth guard on SeedPage | ✅ PASS | `useAuth` now properly imported, page is within admin auth-guarded layout |

---

## Migration Audit

### 20260320000002_fix_admin_subscription_stats.sql

| Check | Result |
|-------|--------|
| Idempotent (`CREATE OR REPLACE`) | ✅ |
| Auth guard preserved | ✅ |
| SECURITY DEFINER preserved | ✅ |
| Correct column references | ✅ — uses `revoked_at`, `starts_at`, `expires_at` which exist on table |
| No schema changes (data-safe) | ✅ — only replaces a function |

### 20260320000003_admin_profiles_rls.sql

| Check | Result |
|-------|--------|
| Idempotent (`DROP IF EXISTS` + `CREATE`) | ✅ |
| RLS uses `is_admin_user()` | ✅ |
| UPDATE has `WITH CHECK` | ✅ |
| No existing policy disruption | ✅ — doesn't DROP any non-admin policies |
| SELECT-only for read, UPDATE for write | ✅ — proper separation |

---

## Implementation Report Verification

| Implementor's Claim | Verified? | Accurate? | Notes |
|---------------------|-----------|-----------|-------|
| "Added missing useAuth import" | ✅ | ✅ | Line 13 of SeedPage.jsx |
| "Created admin RLS bypass policies" | ✅ | ✅ | Both SELECT and UPDATE policies correct |
| "Wired is_beta_tester into 6 locations" | ✅ | ✅ | All 6 locations verified (see table above) |
| "Fixed queries using non-existent columns" | ✅ | ✅ | Both RPC and frontend fixed. Minor `starts_at` inconsistency in JS (MED-001) |

---

## Recommendations

### Mandatory (block merge until done)
None — no critical or high findings.

### Optional Improvements
1. **MED-001:** Add `.lte("starts_at", new Date().toISOString())` to the expiring overrides JS query for consistency with the RPC. Not blocking since future-dated starts aren't currently possible.

### Migrations to Apply
Both migrations must be applied in order before testing:
1. `20260320000002_fix_admin_subscription_stats.sql`
2. `20260320000003_admin_profiles_rls.sql`

---

## Verdict Justification

**🟢 PASS** — All four fixes are correct, well-targeted, and secure. Zero critical findings. Zero high findings. One medium finding (theoretical edge case, not blocking). Migrations are idempotent and security-guarded. No cross-domain regressions. No pattern violations. Ready for merge after applying the two migrations.

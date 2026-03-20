# Implementation Report — Admin Dashboard 4-Fix Bundle

## What Changed

### Fix 1: SeedPage Crash (Critical)
**File:** `mingla-admin/src/pages/SeedPage.jsx`
- Added missing `import { useAuth } from "../context/AuthContext";` (line 13)
- Root cause: `useAuth()` called at line 19 but never imported

### Fix 2: Users Page — Infinite Loading Spinner
**File:** `supabase/migrations/20260320000003_admin_profiles_rls.sql` (NEW)
- Added admin-bypass SELECT policy on `profiles` using `is_admin_user()`
- Added admin-bypass UPDATE policy on `profiles` using `is_admin_user()`
- Root cause: The existing "Profiles viewable except by blocked users" RLS policy calls `is_blocked_by()` per row, making queries extremely slow for admin users querying all profiles
- The new policies are OR'd with existing ones by PostgreSQL, so normal user RLS is unchanged

### Fix 3: Beta Toggle on Users Page
**File:** `mingla-admin/src/pages/UserManagementPage.jsx`
- **List query (line ~203):** Added `is_beta_tester` to the SELECT columns
- **Table columns:** Added "Beta" column after "Status" — shows `<Badge variant="brand">Beta</Badge>` when true, "—" when false
- **Detail header (line ~1129):** Added "Beta Tester" badge next to account_type badge
- **Detail read-only view (line ~1192):** Added "Beta Tester" field showing "Yes"/"No"
- **Edit form checkboxes (line ~1174):** Added "Beta Tester" checkbox
- **Edit form save (line ~518):** Added `is_beta_tester` to the updates object
- The `is_beta_tester` column already exists on `profiles` (migration `20260316000005`)

### Fix 4: Subscription Page 400 Errors
**File:** `mingla-admin/src/pages/SubscriptionManagementPage.jsx`
- Fixed "expiring overrides" query (line ~214): Changed `.eq("is_active", true)` to `.is("revoked_at", null).gt("expires_at", now).lt("expires_at", threeDaysFromNow)`
- The `admin_subscription_overrides` table has no `is_active` column — active status is determined by `revoked_at IS NULL AND expires_at > now()`

**File:** `supabase/migrations/20260320000002_fix_admin_subscription_stats.sql` (NEW)
- Fixed `admin_subscription_stats()` RPC: Changed `WHERE status = 'active'` to `WHERE revoked_at IS NULL AND starts_at <= now() AND expires_at > now()`
- Same root cause — no `status` column on `admin_subscription_overrides`

## Files Created
1. `supabase/migrations/20260320000002_fix_admin_subscription_stats.sql`
2. `supabase/migrations/20260320000003_admin_profiles_rls.sql`

## Files Modified
1. `mingla-admin/src/pages/SeedPage.jsx` — 1 line added (import)
2. `mingla-admin/src/pages/UserManagementPage.jsx` — 6 edits (beta toggle wiring)
3. `mingla-admin/src/pages/SubscriptionManagementPage.jsx` — 1 edit (query fix)

## Migrations to Apply
Both new migrations must be run in order on the Supabase database:
1. `20260320000002_fix_admin_subscription_stats.sql` — fixes the stats RPC
2. `20260320000003_admin_profiles_rls.sql` — adds admin RLS bypass for profiles

## Verification Checklist
- [ ] SeedPage loads without crash
- [ ] Users page loads data (spinner stops)
- [ ] Users list shows "Beta" badge column
- [ ] User detail shows "Beta Tester" badge when true
- [ ] User edit form has "Beta Tester" checkbox
- [ ] Saving beta toggle persists to database
- [ ] Subscription page loads without 400 errors
- [ ] Expiring overrides count works correctly

# Fix: Beta Feedback Admin RLS Policies Use Wrong Identity Check
**Date:** 2026-03-20
**Status:** Planned
**Mode:** Investigation + Fix
**Reported symptom:** Feedback submitted from the mobile app does not appear on the admin Beta Feedback page — page shows "No beta feedback found" with 0 in all stat cards.

---

## 1. Forensic Context

### What Was Reported
User submits feedback from the mobile app. Admin opens Beta Feedback page in the admin dashboard. Page shows zero rows and zero stats. No error message — just an empty table.

### Investigation Summary
**Truth layers inspected:** Docs ✅ Schema ✅ Code ✅ Runtime ✅ Data ✅
**Files read:** 12
**Root cause(s):** Three RLS policies check `profiles.is_admin` instead of `is_admin_user()`
**Contributing factors:** 0
**Hidden flaws found:** 1 (orphaned `profiles.is_admin` column)

### Root Cause Analysis

#### 🔴 RC-001: beta_feedback SELECT policy checks `profiles.is_admin` — a column never set to `true`

**Fact:** `supabase/migrations/20260316000007_beta_feedback_rls_policies.sql` line 19-20 defines:
```sql
USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true))
```
**Fact:** `supabase/migrations/20260316000005_add_beta_tester_admin_flags.sql` line 3 adds `is_admin BOOLEAN NOT NULL DEFAULT false` to profiles.
**Fact:** No migration, edge function, trigger, or auth flow ever sets `profiles.is_admin = true`.
**Fact:** `supabase/migrations/20260317100001_create_admin_subscription_overrides.sql` lines 53-78 define `is_admin_user()` which checks `admin_users.email` where `status = 'active'`.
**Fact:** Every other admin RLS policy in the codebase uses `is_admin_user()`.

**Inference:** The beta_feedback RLS was created on 2026-03-16, one day before `is_admin_user()` was introduced on 2026-03-17. It was never updated to use the canonical function.

**Impact:** Admin users see 0 feedback rows. All stat cards show 0. The entire Beta Feedback page appears empty.

**Defective code:**
```sql
CREATE POLICY "Admins can read all feedback"
  ON beta_feedback FOR SELECT
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));
```

**What it should do:** Allow any active admin (as defined by the `admin_users` table) to SELECT all beta_feedback rows.

**Causal chain:**
1. Admin user authenticates via dashboard (session created via `admin_users` email allowlist + OTP)
2. `BetaFeedbackPage.jsx` runs `supabase.from("beta_feedback").select("*")`
3. RLS evaluates: `EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)`
4. Admin user's profile row has `is_admin = false` (the default, never changed), or has no row in `profiles` at all
5. Policy returns `false` → row excluded → 0 rows returned
6. Page renders "No beta feedback found"

**Invariant violated:** "Any active admin can read all beta_feedback rows"
**Enforced by:** RLS policy using wrong identity source (`profiles.is_admin` instead of `is_admin_user()`)
**Verification:** Replace `profiles.is_admin` check with `is_admin_user()` → admin sees all feedback rows

#### 🔴 RC-002: beta_feedback UPDATE policy has the same broken check

**Fact:** `supabase/migrations/20260316000007_beta_feedback_rls_policies.sql` line 24-25:
```sql
USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));
```
**Impact:** Even if an admin could see rows, they cannot update status or admin_notes.
**Same root cause as RC-001.** Same fix.

#### 🔴 RC-003: Storage policy for admin audio access has the same broken check

**Fact:** `supabase/migrations/20260316000008_beta_feedback_storage_bucket.sql` line 29-34:
```sql
CREATE POLICY "Admins can read all feedback audio"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'beta-feedback'
    AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
  );
```
**Impact:** Admin cannot generate signed URLs for audio playback. Audio player in detail modal would fail even if data were visible.
**Same root cause as RC-001.** Same fix.

#### 🟡 Hidden Flaws

| ID | File | Line | Fact | Inference | Future Risk |
|----|------|------|------|-----------|-------------|
| HF-001 | `20260316000005_add_beta_tester_admin_flags.sql` | 3 | `profiles.is_admin` column exists, defaults to `false`, is never set to `true` by any code path | This column is orphaned — it was intended for RLS but superseded by `is_admin_user()` one day later | Any future developer might use `profiles.is_admin` for new RLS policies, recreating this exact bug. Should be dropped or documented as deprecated. |

#### 🔵 Observations

| ID | File | Note |
|----|------|------|
| OB-001 | `submit-feedback/index.ts` | Edge function uses `supabaseAdmin` (service role), correctly bypassing RLS for INSERT. Mobile submission side is working correctly. |
| OB-002 | `BetaFeedbackPage.jsx` | The admin page code itself is correct. Query construction, filters, pagination, stats — all fine. It's purely an RLS-gating issue. |
| OB-003 | `20260316000007_beta_feedback_rls_policies.sql` | The user-facing SELECT/INSERT policies (using `auth.uid()` and `is_beta_tester`) are correct and unaffected. |

### Invariants That Must Hold After Fix
1. **"Any active admin can read all beta_feedback rows"** — Enforced by: RLS SELECT policy using `is_admin_user()`
2. **"Any active admin can update status/notes on any beta_feedback row"** — Enforced by: RLS UPDATE policy using `is_admin_user()`
3. **"Any active admin can read all audio files in the beta-feedback storage bucket"** — Enforced by: storage SELECT policy using `is_admin_user()`

### What NOT to Change
- **User-facing RLS policies** — The "Users can read own feedback" and "Beta testers can insert feedback" policies on `beta_feedback` are correct. Do not modify.
- **User-facing storage policies** — "Beta testers can upload feedback audio" and "Users can read own feedback audio" are correct.
- **The `submit-feedback` edge function** — Uses service role, works correctly.
- **`BetaFeedbackPage.jsx`** — No code changes needed. The component is correct.
- **`betaFeedbackService.ts`** — No code changes needed. The service is correct.
- **`BetaFeedbackModal.tsx`** — No code changes needed.
- **`profiles.is_beta_tester` column** — This IS used correctly by the INSERT policy and edge function. Do not touch.

---

## 2. Summary

Three RLS policies governing admin access to `beta_feedback` (table SELECT, table UPDATE, and storage SELECT) use `profiles.is_admin = true` as their admin identity check. This column was added with `DEFAULT false` and is never set to `true` by any code path. The canonical admin identity function `is_admin_user()` (which checks the `admin_users` table) was created one day later and used everywhere else, but these three policies were never updated. The fix replaces all three with `is_admin_user()`.

## 3. Design Principle

**Admin identity has exactly one source of truth: `is_admin_user()`.** No RLS policy should roll its own admin check. If a policy needs to know "is this user an admin," it calls `is_admin_user()`. Period.

## 4. Source of Truth Definition

| Entity | Source of Truth | Derived From | Cacheable? | Rebuildable? |
|--------|----------------|-------------|------------|-------------|
| Admin identity | `admin_users` table (email + status = 'active') | — | No | N/A |
| `is_admin_user()` function | `admin_users` table | Lookup on `auth.users.email` → `admin_users` | No (STABLE, re-evaluated per statement) | Yes — function is deterministic given table state |
| `profiles.is_admin` column | **ORPHANED — not a source of truth for anything** | Nothing sets it | N/A | N/A |
| Beta feedback data | `beta_feedback` table | — | No | No (user-generated audio recordings) |
| Beta feedback audio | `beta-feedback` storage bucket | — | Signed URLs expire in 1 hour | No (user-generated binary files) |

## 5. Success Criteria

1. Admin user logs into dashboard → navigates to Beta Feedback page → sees all feedback rows ordered by `created_at` DESC
2. Stat cards show correct counts (total, new, reviewed, actioned, dismissed)
3. Admin can click a feedback row → detail modal opens → audio player loads and plays the recording
4. Admin can change the status of a feedback row via the dropdown → change persists on refresh
5. Admin can type and save admin_notes on a feedback row → notes persist on refresh
6. Admin can use bulk status update (select multiple → change status → apply)
7. A non-admin user (regular app user) still CANNOT read other users' feedback
8. A beta tester can still read their own feedback via the mobile app

## 6. Non-Goals

1. Do NOT drop the `profiles.is_admin` column in this migration — that's a separate cleanup task to avoid scope creep
2. Do NOT modify the `submit-feedback` edge function — it's working correctly
3. Do NOT modify `BetaFeedbackPage.jsx` — it's working correctly, just RLS-gated
4. Do NOT add new features to the feedback page
5. Do NOT modify user-facing (non-admin) RLS policies

---

## 7. Database Changes

### 7.1 New Tables
None.

### 7.2 Modified Tables
None (no ALTER TABLE — only policy changes).

### 7.3 RLS Policy Changes

**Migration file name:** `20260320100000_fix_beta_feedback_admin_rls.sql`

Three policies must be dropped and recreated. Each replaces `EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)` with `is_admin_user()`.

**Policy 1: beta_feedback SELECT**

```sql
-- Drop the broken policy
DROP POLICY IF EXISTS "Admins can read all feedback" ON beta_feedback;

-- Recreate with is_admin_user()
CREATE POLICY "Admins can read all feedback"
  ON beta_feedback FOR SELECT
  USING (is_admin_user());
```

**Policy 2: beta_feedback UPDATE**

```sql
-- Drop the broken policy
DROP POLICY IF EXISTS "Admins can update feedback" ON beta_feedback;

-- Recreate with is_admin_user()
CREATE POLICY "Admins can update feedback"
  ON beta_feedback FOR UPDATE
  USING (is_admin_user());
```

**Policy 3: storage.objects SELECT for beta-feedback bucket**

```sql
-- Drop the broken policy
DROP POLICY IF EXISTS "Admins can read all feedback audio" ON storage.objects;

-- Recreate with is_admin_user()
CREATE POLICY "Admins can read all feedback audio"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'beta-feedback'
    AND is_admin_user()
  );
```

### 7.4 Data Integrity Guarantees

| Invariant | Enforced By | Layer |
|-----------|------------|-------|
| Active admins can read all beta_feedback | RLS SELECT policy → `is_admin_user()` | Schema |
| Active admins can update beta_feedback | RLS UPDATE policy → `is_admin_user()` | Schema |
| Active admins can read all feedback audio | Storage SELECT policy → `is_admin_user()` | Schema |
| Non-admin users can only read own feedback | RLS SELECT policy → `auth.uid() = user_id` | Schema |
| Only beta testers can insert feedback | RLS INSERT policy → `profiles.is_beta_tester` + edge function check | Schema + Code |

---

## 8. Edge Functions

No changes. The `submit-feedback` edge function uses `SUPABASE_SERVICE_ROLE_KEY` (bypasses RLS) and is working correctly.

---

## 9. Mobile Implementation

No changes. The mobile feedback submission flow is working correctly. The bug is exclusively in admin-side RLS policies.

---

## 10. Migration Plan

### Forward Migration

**Single migration file:** `supabase/migrations/20260320100000_fix_beta_feedback_admin_rls.sql`

```sql
-- ============================================================
-- Fix: beta_feedback + storage admin RLS policies
--
-- Problem: Three policies check profiles.is_admin (never set to true)
-- instead of is_admin_user() (the canonical admin identity function).
-- Result: Admin dashboard sees 0 feedback rows despite data existing.
--
-- Fix: Replace all three with is_admin_user().
-- ============================================================

-- 1. Fix beta_feedback SELECT policy for admins
DROP POLICY IF EXISTS "Admins can read all feedback" ON beta_feedback;
CREATE POLICY "Admins can read all feedback"
  ON beta_feedback FOR SELECT
  USING (is_admin_user());

-- 2. Fix beta_feedback UPDATE policy for admins
DROP POLICY IF EXISTS "Admins can update feedback" ON beta_feedback;
CREATE POLICY "Admins can update feedback"
  ON beta_feedback FOR UPDATE
  USING (is_admin_user());

-- 3. Fix storage SELECT policy for admin audio access
DROP POLICY IF EXISTS "Admins can read all feedback audio" ON storage.objects;
CREATE POLICY "Admins can read all feedback audio"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'beta-feedback'
    AND is_admin_user()
  );
```

### Rollback Plan

If the migration causes unexpected issues:

```sql
-- Rollback: restore the old (broken) policies
DROP POLICY IF EXISTS "Admins can read all feedback" ON beta_feedback;
CREATE POLICY "Admins can read all feedback"
  ON beta_feedback FOR SELECT
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));

DROP POLICY IF EXISTS "Admins can update feedback" ON beta_feedback;
CREATE POLICY "Admins can update feedback"
  ON beta_feedback FOR UPDATE
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));

DROP POLICY IF EXISTS "Admins can read all feedback audio" ON storage.objects;
CREATE POLICY "Admins can read all feedback audio"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'beta-feedback'
    AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
  );
```

Note: rollback restores the *broken* behavior (which is the current behavior). There is no "correct previous state" to roll back to — the policies were broken from creation.

### Data Safety

- **Non-destructive.** This migration only drops and recreates RLS policies. No data is modified, no columns are altered, no rows are deleted.
- **No backfill needed.** The existing feedback data in `beta_feedback` is correct and complete.
- **No dual-read window needed.** Policy changes are atomic — the moment the migration completes, the new policies take effect.
- **Old code can still read/write safely.** The user-facing policies are unchanged. The admin page code is unchanged — it just starts receiving data.

---

## 11. Implementation Order

**Step 1: Create the migration file**
- Create `supabase/migrations/20260320100000_fix_beta_feedback_admin_rls.sql` with the exact SQL from §10
- Verify: file exists at correct path with correct content

**Step 2: Apply the migration**
- Run the migration against the Supabase project
- Verify: no SQL errors in output

**Step 3: Verify via SQL**
- Run the verification queries from §13 in the Supabase SQL editor
- Verify: all queries return expected results

**Step 4: Verify via admin dashboard**
- Log into admin dashboard → navigate to Beta Feedback page
- Verify: feedback rows appear, stat cards show non-zero counts
- Click a row → verify detail modal opens with correct data
- Verify audio player loads and plays
- Change status on a row → refresh page → verify change persisted
- Save admin notes → refresh page → verify notes persisted

**Step 5: Verify mobile is unaffected**
- Open mobile app as a beta tester → submit feedback
- Verify: submission succeeds, appears in user's feedback history
- Verify: new submission appears on admin dashboard

---

## 12. Test Cases

| # | Test | Input | Expected | Layer |
|---|------|-------|----------|-------|
| 1 | Admin can see all feedback | Admin loads Beta Feedback page | All rows returned, stat cards accurate | RLS + Admin UI |
| 2 | Admin can update status | Admin changes row status to "reviewed" | Status updates, persists on refresh | RLS UPDATE |
| 3 | Admin can save notes | Admin types notes, clicks Save | Notes persist on refresh | RLS UPDATE |
| 4 | Admin can play audio | Admin clicks row, audio player loads | Audio plays successfully | Storage RLS |
| 5 | Admin can bulk update | Admin selects 3 rows, sets status to "actioned" | All 3 updated | RLS UPDATE |
| 6 | Admin can export CSV | Admin clicks Export CSV with rows visible | CSV downloads with correct data | RLS SELECT |
| 7 | Non-admin cannot see others' feedback | Regular user queries beta_feedback | Only own rows returned (or 0 if not a beta tester) | RLS SELECT |
| 8 | Beta tester can still insert | Beta tester submits feedback from mobile | Row created, visible to admin | RLS INSERT + edge function |
| 9 | Non-beta-tester cannot insert | Regular user tries to submit feedback | Edge function returns 403 | Edge function + RLS INSERT |
| 10 | Admin search works | Admin searches by name | Matching rows returned | RLS SELECT + filter |
| 11 | Admin pagination works | More than 20 rows exist, admin clicks next page | Next 20 rows returned | RLS SELECT + range |
| 12 | Revoked admin loses access | Admin email removed from admin_users / status set to revoked | 0 rows returned on next query | `is_admin_user()` |

---

## 13. Verification Queries

### Pre-Fix Verification (confirm the bug exists)

```sql
-- 1. Confirm feedback rows exist (run with service_role or in SQL editor)
SELECT count(*) AS total_feedback FROM beta_feedback;
-- Expected: > 0 (if any beta tester has submitted feedback)

-- 2. Confirm no profile has is_admin = true
SELECT id, display_name, is_admin FROM profiles WHERE is_admin = true;
-- Expected: 0 rows — proving the column is never set

-- 3. Confirm active admins exist in admin_users
SELECT email, status FROM admin_users WHERE status = 'active';
-- Expected: >= 1 row (the admin user experiencing the bug)

-- 4. Confirm is_admin_user() works for the current admin
-- (Run while authenticated as an admin user)
SELECT is_admin_user();
-- Expected: true
```

### Post-Fix Verification

```sql
-- 1. Confirm new SELECT policy works
-- (Run while authenticated as an admin user via the dashboard's Supabase client)
SELECT count(*) FROM beta_feedback;
-- Expected: matches the service_role count from pre-fix query #1

-- 2. Confirm UPDATE policy works
UPDATE beta_feedback SET status = status WHERE id = (SELECT id FROM beta_feedback LIMIT 1);
-- Expected: 1 row affected (no-op update, just testing permission)

-- 3. Confirm storage policy works
-- (Verify from admin dashboard: open a feedback detail → audio player loads)

-- 4. Confirm user-facing policies still work
-- (Run while authenticated as a regular beta tester)
SELECT count(*) FROM beta_feedback;
-- Expected: only their own rows (not all rows)

-- 5. Confirm non-admin non-owner sees nothing
-- (Run while authenticated as a regular non-beta-tester user)
SELECT count(*) FROM beta_feedback;
-- Expected: 0
```

### Policy Existence Check

```sql
-- Confirm the three new policies exist with correct definitions
SELECT policyname, cmd, qual
FROM pg_policies
WHERE tablename = 'beta_feedback'
  AND policyname IN ('Admins can read all feedback', 'Admins can update feedback');
-- Expected: 2 rows, qual should reference is_admin_user() not profiles.is_admin

-- Check storage policy
SELECT policyname, cmd, qual
FROM pg_policies
WHERE tablename = 'objects'
  AND schemaname = 'storage'
  AND policyname = 'Admins can read all feedback audio';
-- Expected: 1 row, qual should reference is_admin_user()
```

---

## 14. Common Mistakes to Avoid

1. **Forgetting the storage policy:** There are THREE policies to fix, not two. The storage.objects policy is easy to miss because it's in a different migration file and on a different table.
2. **Using `WITH CHECK` on SELECT policies:** SELECT policies use `USING`, not `WITH CHECK`. `WITH CHECK` is for INSERT/UPDATE operations.
3. **Adding `WITH CHECK` to the UPDATE policy:** The UPDATE policy only needs `USING` (which controls which rows can be seen for update). A `WITH CHECK` on UPDATE would control what values can be written — not needed here since we're only gating access, not constraining values.
4. **Modifying user-facing policies:** The "Users can read own feedback" and "Beta testers can insert feedback" policies are correct. Do not touch them.
5. **Trying to fix by setting `profiles.is_admin = true`:** This would be a band-aid. The correct fix is to use `is_admin_user()`, which is the canonical admin identity check used everywhere else. Setting the column would create a second admin identity source of truth that can drift.

---

## 15. Handoff to Implementor

Implementor: this is your single source of truth. §3 is the design principle — admin identity has exactly one source of truth: `is_admin_user()`. §4 defines what is authoritative — the `admin_users` table, not `profiles.is_admin`. §1 contains the forensic diagnosis — read it to understand WHY these policies were wrong.

Execute in order from §11. The entire fix is a single migration file with 6 SQL statements (3 DROP + 3 CREATE). No application code changes. No edge function changes. No mobile changes.

After applying the migration, verify using §13 queries. Then verify via the admin dashboard UI per §11 Step 4.

Not done until tester's report is green on all 12 test cases in §12.

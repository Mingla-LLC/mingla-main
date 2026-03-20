# Investigation: Feedback Submitted from Mobile App Not Visible in Admin Dashboard

**Date:** 2026-03-20
**Symptom:** User submits feedback from the mobile app, but the Beta Feedback page in the admin dashboard shows no data.
**Severity:** 🔴 Critical — entire feedback feature is silently broken for admin users

---

## Executive Summary

The beta_feedback table's RLS policies use a **different admin identity mechanism** than the rest of the admin dashboard. Every other admin table uses `is_admin_user()` (checks `admin_users` table), but beta_feedback checks `profiles.is_admin` — a column that is **never set to `true`** for admin dashboard users. The result: RLS silently returns 0 rows. No error, no toast, just an empty table.

---

## 1. The Full Chain (Mobile → DB → Admin)

```
MOBILE APP                         DATABASE                          ADMIN DASHBOARD
─────────                          ────────                          ───────────────
BetaFeedbackModal.tsx              beta_feedback table               BetaFeedbackPage.jsx
  → useBetaFeedback.ts               ↑                                → supabase.from("beta_feedback")
    → betaFeedbackService.ts         │                                   .select("*")
      → uploadFeedbackAudio()        │                                   .order("created_at", {desc})
      → supabase.functions           │                                ↓
        .invoke('submit-feedback')   │                              RLS CHECK:
          ↓                          │                              EXISTS (SELECT 1 FROM profiles
        submit-feedback/index.ts     │                                WHERE id = auth.uid()
          → supabaseAdmin.insert()───┘                                AND is_admin = true)
            (uses SERVICE_ROLE_KEY                                        ↓
             bypasses RLS)                                           RETURNS FALSE → 0 rows
```

---

## 2. Root Cause (Proven)

### 🔴 ROOT CAUSE: RLS policy uses wrong admin identity check

**File:** `supabase/migrations/20260316000007_beta_feedback_rls_policies.sql`, lines 17-20

**Defective code:**
```sql
CREATE POLICY "Admins can read all feedback"
  ON beta_feedback FOR SELECT
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));
```

**What it should do:** Allow admin dashboard users to read all feedback rows.

**What it actually does:** Checks `profiles.is_admin`, which is `false` (default) for every admin user because:

1. The `profiles.is_admin` column was added in migration `20260316000005` with `DEFAULT false`
2. **No migration, edge function, or auth flow ever sets `profiles.is_admin = true`**
3. Admin dashboard users are authenticated via the `admin_users` table (email + password + OTP), not via `profiles.is_admin`
4. The canonical admin identity function `is_admin_user()` was created later in migration `20260317100001` and checks `admin_users.email + status = 'active'` — NOT `profiles.is_admin`
5. Every other admin RLS policy in the entire codebase uses `is_admin_user()`:
   - `20260317210000_admin_dashboard_overhaul.sql` → `is_admin_user()`
   - `20260317100002_admin_photo_pool_management.sql` → `is_admin_user()`
   - `20260317100003_admin_place_refresh.sql` → `is_admin_user()`
   - `20260319100000_manual_stale_place_lifecycle.sql` → `is_admin_user()`
   - `20260320000003_admin_profiles_rls.sql` → `is_admin_user()`
6. The beta_feedback RLS was written on 2026-03-16, **one day before** `is_admin_user()` was created on 2026-03-17

**Causal chain:**
1. Admin user logs into dashboard (authenticated via `admin_users` table)
2. `BetaFeedbackPage.jsx` queries `supabase.from("beta_feedback").select("*")`
3. Supabase evaluates RLS policy "Admins can read all feedback"
4. Policy runs: `EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)`
5. Admin user either has no row in `profiles` at all, or has `is_admin = false` (the default)
6. Policy returns `false` → row filtered out → 0 rows returned
7. Page renders "No beta feedback found" with 0 in all stat cards

**Verification:** Run this SQL in the Supabase dashboard to confirm:
```sql
-- Check if ANY profile has is_admin = true
SELECT id, display_name, is_admin FROM profiles WHERE is_admin = true;
-- Expected: 0 rows

-- Check admin_users table (the real admin identity)
SELECT email, status FROM admin_users WHERE status = 'active';
-- Expected: your admin emails

-- Check if feedback rows actually exist
SELECT count(*) FROM beta_feedback;  -- Run with service_role key
-- Expected: > 0 if any feedback was submitted
```

---

## 3. Same Bug Affects UPDATE Policy

**File:** `supabase/migrations/20260316000007_beta_feedback_rls_policies.sql`, lines 23-25

```sql
CREATE POLICY "Admins can update feedback"
  ON beta_feedback FOR UPDATE
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));
```

Even if an admin could somehow see feedback rows, they would not be able to update status or admin_notes. Same root cause — `profiles.is_admin` instead of `is_admin_user()`.

---

## 4. Same Bug Affects Storage RLS

**File:** `supabase/migrations/20260316000008_beta_feedback_storage_bucket.sql`, line 33

```sql
AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
```

Admin users cannot generate signed URLs for audio playback. Even if the data bug were fixed, the audio player would fail to load files.

---

## 5. Mobile Submission Side — Confirmed Working

The mobile submission path is **not broken**:

- `submit-feedback/index.ts` uses `SUPABASE_SERVICE_ROLE_KEY` (line 31), which **bypasses RLS entirely**
- The edge function validates `is_beta_tester` via a direct profile lookup (line 54-58)
- Insert happens via `supabaseAdmin` client, not the user's JWT
- **Fact:** If a beta tester submits feedback, the row IS being written to the database. The admin just can't see it.

---

## 6. Why This Bug Is Silent

- Supabase RLS returns **0 rows** on policy denial, not an error
- The admin page handles 0 rows gracefully: "No beta feedback found"
- All stat counts show 0 (they hit the same RLS-gated table)
- No console error, no toast, no indication anything is wrong
- The admin user naturally assumes "no one has submitted feedback yet"

---

## 7. Fix Specification

### Migration: Replace `profiles.is_admin` with `is_admin_user()` in all three policies

```sql
-- Fix beta_feedback SELECT policy
DROP POLICY IF EXISTS "Admins can read all feedback" ON beta_feedback;
CREATE POLICY "Admins can read all feedback"
  ON beta_feedback FOR SELECT
  USING (is_admin_user());

-- Fix beta_feedback UPDATE policy
DROP POLICY IF EXISTS "Admins can update feedback" ON beta_feedback;
CREATE POLICY "Admins can update feedback"
  ON beta_feedback FOR UPDATE
  USING (is_admin_user());

-- Fix storage policy for admin audio access
-- (Requires updating the storage.objects policy for the beta-feedback bucket)
-- The exact policy name needs to be looked up in the storage policies,
-- but the WHERE clause must change from:
--   EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
-- To:
--   is_admin_user()
```

### Why `is_admin_user()` is correct:
- It's `SECURITY DEFINER` — runs with elevated privileges to read `admin_users` table
- It checks `admin_users.email` where `status = 'active'` — matching the dashboard's auth flow
- Every other admin RLS policy in the codebase uses it
- It's the canonical, single source of truth for "is this user an admin"

### Optional cleanup:
- Consider dropping `profiles.is_admin` column entirely if nothing else uses it
- Or: add a trigger/migration that sets `profiles.is_admin = true` when `admin_users.status` changes to `'active'` (but this adds complexity — prefer `is_admin_user()`)

---

## 8. Testing Plan

1. **Before fix:** Log into admin dashboard → Beta Feedback page → confirm 0 rows, 0 stats
2. **Before fix:** Run `SELECT count(*) FROM beta_feedback` with service_role → confirm rows exist
3. **Apply migration**
4. **After fix:** Refresh Beta Feedback page → confirm rows appear with correct data
5. **After fix:** Click a feedback row → confirm detail modal opens, audio player loads
6. **After fix:** Change status on a row → confirm it saves (tests UPDATE policy)
7. **After fix:** Submit new feedback from mobile app → confirm it appears in admin within seconds

---

## 9. Files Involved

| File | Role | Issue |
|------|------|-------|
| `supabase/migrations/20260316000007_beta_feedback_rls_policies.sql` | RLS for beta_feedback | Uses `profiles.is_admin` instead of `is_admin_user()` |
| `supabase/migrations/20260316000008_beta_feedback_storage_bucket.sql` | Storage RLS for audio | Same bug — `profiles.is_admin` |
| `supabase/migrations/20260317100001_create_admin_subscription_overrides.sql:53-78` | Defines `is_admin_user()` | This is the correct function to use |
| `supabase/migrations/20260316000005_add_beta_tester_admin_flags.sql` | Added `profiles.is_admin` | Column exists but is never set to `true` |
| `mingla-admin/src/pages/BetaFeedbackPage.jsx` | Admin feedback page | Code is correct — just blocked by RLS |
| `supabase/functions/submit-feedback/index.ts` | Edge function for submission | Working correctly — uses service role |
| `app-mobile/src/services/betaFeedbackService.ts` | Mobile submission service | Working correctly |

---

## 10. Invariant That Should Hold

**"Any user authenticated as an active admin in the admin dashboard can read and update all beta_feedback rows."**

**Current enforcement:** `profiles.is_admin` column (BROKEN — never set)
**Correct enforcement:** `is_admin_user()` function (checks `admin_users` table)

The bad state (admin can't see feedback) is not just possible — it is **guaranteed** for every admin user.

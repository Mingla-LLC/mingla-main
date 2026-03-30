# Implementation Report: Fix Profile Deletion Chain

**Date:** 2026-03-30

## What Was Broken

When a user deleted their account, the auth user was removed but the profile row survived as an orphan. When they tried to re-register with the same Apple ID/email, the `handle_new_user` trigger hit the `profiles_email_unique` constraint and returned "Database error saving new user."

## Root Cause Chain

1. `profiles.id` had **no FK** to `auth.users(id)` — no CASCADE on auth user deletion
2. Edge function's manual profile delete (Step 5) triggered `preferences` CASCADE
3. The `create_preference_history` trigger fired on the CASCADE delete
4. Trigger used `NEW.profile_id` — but `NEW` is NULL during DELETE → NOT NULL violation
5. Transaction aborted → profile delete failed → orphan survived
6. Edge function caught the error as a warning and **returned 200 success** — lied to the user

## What Changed

### Migration: `20260330000003_fix_profile_deletion_chain.sql`
- **Trigger fix:** `create_preference_history` now returns OLD immediately on DELETE (skips history)
- **Orphan cleanup:** Deleted ALL orphan profiles (profiles with no matching auth.users row)
- **FK addition:** `profiles.id REFERENCES auth.users(id) ON DELETE CASCADE`

### Edge Function: `supabase/functions/delete-user/index.ts`
- Step 5 now **verifies** the profile is gone after auth deletion
- If the profile survives CASCADE, deletes it explicitly
- If explicit delete also fails, returns **error response** (not success)

## Verification (Production)

| Check | Result |
|-------|--------|
| Orphan profiles count | 0 |
| FK constraint exists | Yes (`profiles_id_fkey_auth_users`) |
| Trigger handles DELETE | Yes (returns OLD, no INSERT) |
| Edge function deployed | v94 |
| User can re-register | Unblocked (orphan deleted) |

## Files Modified

1. `supabase/migrations/20260330000003_fix_profile_deletion_chain.sql` (new)
2. `supabase/functions/delete-user/index.ts` (Step 5 rewrite)

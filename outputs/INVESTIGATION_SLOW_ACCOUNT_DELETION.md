# Investigation: Slow Account Deletion

## What's Happening (Plain English)

When you tap "Delete My Account," the app calls an edge function that does a **massive amount of sequential work** — cleaning up 45+ database tables one by one. The work is done in 4 phases, and **everything happens serially where it could be parallel, AND the same work is done twice** (once in the edge function, once in a database trigger).

The client has a 45-second timeout. If the edge function takes longer, the app shows "This is taking longer than expected."

## The Full Deletion Chain

```
User taps "Delete My Account"
  → AccountSettings.tsx:349 — calls supabase.functions.invoke("delete-user")
  → 45-second wall-clock timeout races against the function
  → Edge function delete-user/index.ts does:
      Step 0: Fetch user phone (1 query)
      Step 1: cleanupCollaborationSessions() — up to 9 queries
      Step 2: cleanupUserData() — 45+ individual DELETE queries across 4 batches
      Step 2.5: Clear phone from profiles + auth.users (2 queries)
      Step 3: auth.admin.deleteUser() — deletes auth record
      Step 4: RPC delete_user_profile() — which:
        - Disables triggers on preferences + profiles
        - Deletes preferences, preference_history, profiles
        - Re-enables triggers
        - BUT this fires on_profile_delete_cleanup trigger (if enabled)
          which does ANOTHER 20+ DELETEs of the SAME tables
```

## Root Causes of Slowness

### 🔴 ROOT CAUSE 1: Massive Duplication — Edge Function + Trigger Do the Same Work

**Fact:** The edge function `cleanupUserData()` (lines 176-333) explicitly deletes from ~32 tables.

**Fact:** The database trigger `handle_user_deletion_cleanup()` (migration 20260310000013) fires on `DELETE FROM profiles` and deletes from ~20 of those SAME tables.

**Fact:** The `delete_user_profile` RPC (migration 20260317000002) disables `USER` triggers before deleting the profile — but `handle_user_deletion_cleanup` is a `BEFORE DELETE` trigger on profiles. If the trigger disable works, the trigger doesn't fire and the edge function's cleanup is the only path. If it DOESN'T work (exception is caught and swallowed), the trigger fires and re-does everything.

**Inference:** You're either doing the work once (if trigger disable succeeds) or twice (if it fails). Either way, the edge function's 45+ queries are the bottleneck.

### 🔴 ROOT CAUSE 2: Sequential Batches Where Full Parallelism Is Possible

**Fact:** `cleanupUserData()` uses 4 sequential `Promise.allSettled` batches:
- Batch 1: 5 deletes (user interactions)
- Beta feedback anonymize (sequential)
- Batch 2: 4 deletes (social data)
- Messages soft-delete (sequential)
- Batch 3: 32 deletes (board, calendar, presence, misc)
- Pending invites by phone: 3 sequential updates
- Pending invites by inviter_id: 2 deletes

**Inference:** Batches 1-4 are `await`ed sequentially. Each batch waits for the previous to finish. Most of these have ZERO dependencies on each other — they could ALL run in a single `Promise.allSettled`.

### 🔴 ROOT CAUSE 3: Collaboration Session Cleanup Uses N+1 Pattern for Ownership Transfer

**Fact:** `cleanupCollaborationSessions()` line 78 uses `Promise.allSettled` with individual UPDATE queries per session:
```typescript
transferable.map(({ sessionId, newOwner }) =>
  supabase.from("collaboration_sessions").update({ created_by: newOwner }).eq("id", sessionId)
)
```

**Inference:** If a user owns 10 sessions, this fires 10 individual UPDATE queries. Could be 1 bulk query.

### 🟠 CONTRIBUTING FACTOR: Cold Start on Deno Edge Function

**Fact:** Edge functions on Supabase run on Deno Deploy. First invocation after idle has a cold start penalty (typically 500ms-2s).

**Inference:** This adds to perceived latency but isn't the main issue.

### 🟠 CONTRIBUTING FACTOR: `safeDelete` Helper Swallows Errors Silently

**Fact:** Every `safeDelete` call (line 183-192) wraps the delete in try-catch and only `console.warn`s on failure. If a table doesn't exist or the query fails, it silently continues.

**Inference:** Not a performance issue, but means you could have phantom failures during deletion with no user visibility.

## Estimated Time Breakdown

For a typical user with some activity:

| Step | Queries | Est. Time |
|------|---------|-----------|
| Step 0: Fetch phone | 1 | ~50ms |
| Step 1: Collab cleanup | 5-9 | ~500ms-1s |
| Step 2 Batch 1: Interactions | 5 parallel | ~200ms |
| Step 2: Beta feedback | 1 | ~100ms |
| Step 2 Batch 2: Social | 4 parallel | ~200ms |
| Step 2: Messages soft-delete | 1 | ~100ms |
| Step 2 Batch 3: Everything else | 32 parallel | ~500ms |
| Step 2: Pending invites (phone) | 3 sequential | ~300ms |
| Step 2: Pending invites (inviter) | 2 parallel | ~100ms |
| Step 2.5: Clear phone | 2 | ~200ms |
| Step 3: Delete auth user | 1 | ~500ms |
| Step 4: Delete profile RPC | 1 (trigger fires 20+ internal) | ~1-3s |
| **Total** | **~60+ queries** | **~4-7 seconds typical** |

For a power user with many sessions, messages, and interactions, this could easily hit 15-30 seconds. The trigger re-doing work could double it.

## Invariants That Should Hold

1. **No work should be done twice.** Either the edge function cleans up OR the trigger cleans up — not both.
2. **Independent deletes should be parallel.** There's no FK dependency between `user_interactions` and `friends` — they can run simultaneously.
3. **Bulk operations should be bulk.** Ownership transfers should be a single UPDATE with CASE/WHEN, not N individual queries.

## Recommended Fix

### Option A: Lean on the Database Trigger (Simpler, Faster)

The `handle_user_deletion_cleanup` trigger already does most of the work. The edge function could be simplified to:

1. Fetch phone
2. Cancel pending invites by phone (trigger can't do this — it doesn't know the phone)
3. Clear phone from profiles + auth.users
4. `auth.admin.deleteUser()`
5. `delete_user_profile()` RPC → trigger handles all table cleanup

This reduces the edge function from ~60 queries to ~8. The trigger runs inside a single database transaction — much faster than 45 individual HTTP round-trips from the edge function to the database.

### Option B: Kill the Trigger, Optimize the Edge Function (More Control)

1. Drop the `on_profile_delete_cleanup` trigger entirely
2. Collapse ALL `cleanupUserData` batches into a SINGLE `Promise.allSettled` (one batch, not four)
3. Replace N+1 ownership transfers with a single bulk UPDATE
4. Run phone cleanup in parallel with data cleanup

This keeps all logic in one place (edge function) and makes it explicit.

### Recommendation: Option A

The database trigger runs server-side in a single transaction with zero network overhead per query. The edge function makes individual Supabase client calls, each with HTTP round-trip overhead (~50-100ms per call from edge function to database). For 45+ operations, that overhead alone is 2-4 seconds.

**Option A would reduce deletion time from 5-30 seconds to under 2 seconds.**

## Verification

After implementing, test with:
1. New user (minimal data) — should complete in < 1s
2. Active user with sessions, messages, friends — should complete in < 3s
3. Check Supabase logs to confirm trigger fires correctly and no duplicate work

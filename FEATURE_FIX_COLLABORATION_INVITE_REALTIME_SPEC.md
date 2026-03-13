# Feature: Fix Collaboration Invite — Realtime, In-App Notifications, Push Reliability

**Date:** 2026-03-12
**Status:** Planned
**Requested by:** "When I send a collaboration invite, the greyed pill appears immediately for me, but it takes a while for my friend, and they don't get an in-app or push notification."

---

## 1. Summary

Four systemic failures prevent the recipient from seeing collaboration invites instantly: (1) the `collaboration_invites`, `collaboration_sessions`, and `session_participants` tables are **not added to the Supabase Realtime publication**, so every realtime subscription listening to these tables receives zero events; (2) in-app notifications are only created when the push arrives while the app is in foreground — there is no catch-up mechanism when the app resumes from background; (3) there are **two competing realtime channels** (`collaboration_pill_changes_${userId}` in index.tsx and `collaboration-updates-${userId}` in useSessionManagement.ts) subscribing to the exact same three tables, meaning once realtime is enabled, every event fires double data fetches; (4) the `collaboration_invites` table has **TWO pairs of duplicate columns** (`invitee_id`/`invited_user_id` for the recipient, `inviter_id`/`invited_by` for the sender), kept in sync by fragile BEFORE INSERT/UPDATE triggers — app code is split across both, realtime filters only match one, and if either trigger is ever dropped, the system silently breaks. This spec fixes all four root causes plus five related stability issues.

## 2. User Story

As a Mingla user who receives a collaboration invite, I want the invite pill to appear on my home screen within 1-2 seconds, an in-app notification to appear in my bell icon immediately, and a push notification to arrive on my lock screen — regardless of whether my app is in foreground, background, or killed.

## 3. Success Criteria

1. When User A sends a collaboration invite to User B, User B's grey pill appears within 2 seconds (if app is in foreground).
2. User B sees an in-app notification (bell icon badge increments) within 2 seconds of the invite being created, whether the app is in foreground or resumed from background.
3. User B receives a push notification on their lock screen if the app is in background or killed.
4. If User B opens the app after receiving a push (without tapping the push), the in-app notification is still created via the catch-up mechanism.
5. No duplicate notifications are created — ever. Not from push + catch-up, not from multiple realtime events, not from foreground/background transitions.
6. Creating a session with 3 friends triggers at most 2 `refreshAllSessions()` / `loadUserSessions()` calls on the creator's device (debounce batching), not 8+.
7. The two competing realtime channels are consolidated into one, eliminating double-fetch.
8. The `collaboration_invites` table has exactly TWO columns for participants — `inviter_id` (sender) and `invited_user_id` (recipient). The legacy aliases `invited_by` and `invitee_id` are removed. All app code, RLS policies, triggers, realtime filters, and edge functions reference the canonical columns only.
9. No sync triggers remain on `collaboration_invites` — the column duplication that required them is eliminated.

---

## 4. Database Changes

### 4.1 New Tables

None.

### 4.2 Migration: Add Collaboration Tables to Realtime Publication

**File:** `supabase/migrations/[next_timestamp]_add_collaboration_tables_to_realtime.sql`

```sql
-- Migration: add_collaboration_tables_to_realtime
-- Description: Adds collaboration_invites, collaboration_sessions, and
-- session_participants to the supabase_realtime publication so that
-- postgres_changes subscriptions actually receive events.
-- Without this, every .on('postgres_changes', { table: 'collaboration_invites' })
-- in the mobile app silently receives zero events.

-- Use DO block with exception handling so the migration is idempotent.
-- ALTER PUBLICATION ... ADD TABLE throws if the table is already a member.

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.collaboration_invites;
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'collaboration_invites already in supabase_realtime';
END;
$$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.collaboration_sessions;
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'collaboration_sessions already in supabase_realtime';
END;
$$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.session_participants;
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'session_participants already in supabase_realtime';
END;
$$;
```

### 4.3 RLS Policy Verification

Supabase Realtime filters events through the listening user's RLS SELECT policy. The existing `ci_select` policy on `collaboration_invites` (from migration `20250227000004`) already grants SELECT to `invitee_id`, `invited_user_id`, `inviter_id`, `invited_by`, and session creators. This is correct — the recipient will receive realtime events for invites targeting them.

**No RLS changes required.** Verified — existing policies are sufficient.

### 4.4 Migration: Consolidate Duplicate Columns on `collaboration_invites`

**File:** `supabase/migrations/[next_timestamp]_consolidate_collaboration_invite_columns.sql`

**Background:** The `collaboration_invites` table has two pairs of duplicate columns kept in sync by BEFORE INSERT/UPDATE triggers:

| Canonical (KEEP) | Alias (DROP) | Sync trigger | App references (canonical) | App references (alias) |
|---|---|---|---|---|
| `invited_user_id` | `invitee_id` | `sync_invite_ids` | 25 | 13 |
| `inviter_id` | `invited_by` | `sync_invite_inviter_ids` | 17 | 17 |

**Why `invited_user_id` wins over `invitee_id`:**
- 25 vs 13 app references — `invited_user_id` is used by more code
- Has the unique constraint (`collaboration_invites_session_invited_user_unique`)
- Has a dedicated index (`idx_collaboration_invites_invited_user_id`)
- The sync trigger already "prefers" it (when both are set, `invitee_id` is overwritten from `invited_user_id`)

**Why `inviter_id` wins over `invited_by`:**
- `inviter_id` is the original column from the CREATE TABLE (Jan 2025)
- `invited_by` was added as an alias in Feb 2025
- The sync trigger already "prefers" `inviter_id` (when both are set, `invited_by` is overwritten from `inviter_id`)
- Foreign key constraint on `inviter_id` is NOT NULL — it's the more constrained column

**Strategy:** This is a two-phase migration. Phase 1 (this migration) ensures all data is synced and drops the triggers + alias columns. Phase 2 is the app code update (§6.3).

**CRITICAL ORDERING:** The app code changes in §6.3 MUST be deployed BEFORE this migration runs. If the migration drops `invitee_id` while app code still queries it, those queries will fail with "column does not exist." The safe sequence:
1. Deploy app code that uses only `invited_user_id` and `inviter_id` (§6.3)
2. Run this migration to drop the alias columns

```sql
-- Migration: consolidate_collaboration_invite_columns
-- Description: Removes duplicate alias columns (invitee_id, invited_by) from
-- collaboration_invites table and their sync triggers. After this migration,
-- the table has exactly two participant columns: inviter_id (sender) and
-- invited_user_id (recipient).
--
-- PREREQUISITE: All app code must already use invited_user_id / inviter_id
-- exclusively. Verify no code references invitee_id or invited_by before running.

-- ═══════════════════════════════════════════════════════════
-- Step 1: Final sync — ensure no rows have data only in alias columns
-- ═══════════════════════════════════════════════════════════

-- Copy any invitee_id-only values to invited_user_id
UPDATE public.collaboration_invites
SET invited_user_id = invitee_id
WHERE invited_user_id IS NULL AND invitee_id IS NOT NULL;

-- Copy any invited_by-only values to inviter_id
UPDATE public.collaboration_invites
SET inviter_id = invited_by
WHERE inviter_id IS NULL AND invited_by IS NOT NULL;

-- ═══════════════════════════════════════════════════════════
-- Step 2: Drop sync triggers (they reference the alias columns)
-- ═══════════════════════════════════════════════════════════

DROP TRIGGER IF EXISTS sync_invite_ids ON public.collaboration_invites;
DROP FUNCTION IF EXISTS public.sync_invite_user_id();

DROP TRIGGER IF EXISTS sync_invite_inviter_ids ON public.collaboration_invites;
DROP FUNCTION IF EXISTS public.sync_invite_inviter_id();

-- ═══════════════════════════════════════════════════════════
-- Step 3: Update RLS policies to remove alias column references
-- ═══════════════════════════════════════════════════════════

-- SELECT policy: was checking 4 columns, now checks 2
DROP POLICY IF EXISTS "ci_select" ON public.collaboration_invites;
CREATE POLICY "ci_select" ON public.collaboration_invites
FOR SELECT USING (
  auth.uid() = invited_user_id
  OR auth.uid() = inviter_id
  OR public.is_session_creator(session_id, auth.uid())
);

-- INSERT policy: was checking inviter_id OR invited_by, now just inviter_id
DROP POLICY IF EXISTS "ci_insert" ON public.collaboration_invites;
CREATE POLICY "ci_insert" ON public.collaboration_invites
FOR INSERT WITH CHECK (
  auth.uid() = inviter_id
  OR public.is_session_creator(session_id, auth.uid())
);

-- UPDATE policy: was checking 4 columns, now checks 2
DROP POLICY IF EXISTS "ci_update" ON public.collaboration_invites;
CREATE POLICY "ci_update" ON public.collaboration_invites
FOR UPDATE USING (
  auth.uid() = invited_user_id
  OR auth.uid() = inviter_id
  OR public.is_session_creator(session_id, auth.uid())
);

-- DELETE policy: was checking 4 columns, now checks 2
DROP POLICY IF EXISTS "ci_delete" ON public.collaboration_invites;
CREATE POLICY "ci_delete" ON public.collaboration_invites
FOR DELETE USING (
  auth.uid() = invited_user_id
  OR auth.uid() = inviter_id
  OR public.is_session_creator(session_id, auth.uid())
);

-- ═══════════════════════════════════════════════════════════
-- Step 4: Update helper function that checks both columns
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.has_session_invite(p_session_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.collaboration_invites
    WHERE session_id = p_session_id
    AND invited_user_id = p_user_id
    AND status IN ('pending', 'accepted')
  );
$$;

-- ═══════════════════════════════════════════════════════════
-- Step 5: Update the phone invite conversion trigger to use canonical columns
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.convert_pending_invites_on_phone_verified()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  pending RECORD;
  session_pending RECORD;
  new_invite_id UUID;
BEGIN
  IF NEW.phone IS NULL OR (OLD.phone IS NOT NULL AND OLD.phone = NEW.phone) THEN
    RETURN NEW;
  END IF;

  -- PART 1: Convert pending friend invites (unchanged)
  FOR pending IN
    SELECT * FROM public.pending_invites
    WHERE phone_e164 = NEW.phone
      AND status = 'pending'
      AND inviter_id != NEW.id
  LOOP
    INSERT INTO public.friend_requests (sender_id, receiver_id, status)
    VALUES (pending.inviter_id, NEW.id, 'pending')
    ON CONFLICT (sender_id, receiver_id) DO NOTHING;

    INSERT INTO public.friend_links (requester_id, target_id, status)
    VALUES (pending.inviter_id, NEW.id, 'pending')
    ON CONFLICT DO NOTHING;

    UPDATE public.pending_invites
    SET status = 'converted', converted_user_id = NEW.id, converted_at = NOW()
    WHERE id = pending.id;

    INSERT INTO public.referral_credits (referrer_id, referred_id, pending_invite_id, status)
    VALUES (pending.inviter_id, NEW.id, pending.id, 'pending')
    ON CONFLICT (referrer_id, referred_id) DO NOTHING;
  END LOOP;

  -- PART 2: Convert pending SESSION invites — now uses canonical columns
  FOR session_pending IN
    SELECT * FROM public.pending_session_invites
    WHERE phone_e164 = NEW.phone
      AND status = 'pending'
      AND inviter_id != NEW.id
  LOOP
    INSERT INTO public.collaboration_invites (
      session_id, inviter_id, invited_user_id, status
    )
    VALUES (
      session_pending.session_id,
      session_pending.inviter_id,
      NEW.id,
      'pending'
    )
    ON CONFLICT DO NOTHING
    RETURNING id INTO new_invite_id;

    IF new_invite_id IS NOT NULL THEN
      INSERT INTO public.session_participants (session_id, user_id, has_accepted)
      VALUES (session_pending.session_id, NEW.id, false)
      ON CONFLICT (session_id, user_id) DO NOTHING;
    END IF;

    UPDATE public.pending_session_invites
    SET status = 'converted',
        converted_invite_id = COALESCE(new_invite_id, converted_invite_id),
        updated_at = NOW()
    WHERE id = session_pending.id;
  END LOOP;

  RETURN NEW;
END;
$$;

-- Re-attach trigger (idempotent)
DROP TRIGGER IF EXISTS trg_convert_pending_invites_on_phone ON public.profiles;
CREATE TRIGGER trg_convert_pending_invites_on_phone
  AFTER UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.convert_pending_invites_on_phone_verified();

-- ═══════════════════════════════════════════════════════════
-- Step 6: Drop the alias columns
-- ═══════════════════════════════════════════════════════════

-- Drop index on invited_by first
DROP INDEX IF EXISTS idx_collaboration_invites_invited_by;

-- Drop alias columns
ALTER TABLE public.collaboration_invites DROP COLUMN IF EXISTS invitee_id;
ALTER TABLE public.collaboration_invites DROP COLUMN IF EXISTS invited_by;
```

### 4.5 RLS Policy Summary (After Consolidation)

| Table | Policy Name | Operation | Rule |
|-------|-------------|-----------|------|
| collaboration_invites | ci_select | SELECT | `auth.uid() = invited_user_id OR auth.uid() = inviter_id OR is_session_creator(session_id, auth.uid())` |
| collaboration_invites | ci_insert | INSERT | `auth.uid() = inviter_id OR is_session_creator(session_id, auth.uid())` |
| collaboration_invites | ci_update | UPDATE | `auth.uid() = invited_user_id OR auth.uid() = inviter_id OR is_session_creator(session_id, auth.uid())` |
| collaboration_invites | ci_delete | DELETE | `auth.uid() = invited_user_id OR auth.uid() = inviter_id OR is_session_creator(session_id, auth.uid())` |

---

## 5. Edge Functions

### 5.1 No changes to `send-collaboration-invite`

The edge function correctly sends push notifications via OneSignal. The push delivery path is functional — the issue is on the mobile receiving side.

### 5.2 Update `delete-user` to use canonical columns only

**File:** `supabase/functions/delete-user/index.ts`
**Where:** Lines 182-183

**Change this:**
```typescript
safeDelete("collaboration_invites", "inviter_id", userId),
safeDelete("collaboration_invites", "invitee_id", userId),
```

**To this:**
```typescript
safeDelete("collaboration_invites", "inviter_id", userId),
safeDelete("collaboration_invites", "invited_user_id", userId),
```

**Why:** After the migration drops `invitee_id`, this delete call would fail with "column does not exist." The `ON DELETE CASCADE` FK on `invited_user_id` would handle this anyway, but the explicit cleanup is belt-and-suspenders — it must reference the correct column.

---

## 6. Mobile Implementation

### 6.1 PROBLEM: Two Competing Realtime Channels (MUST FIX FIRST)

**The conflict:** Two realtime channels subscribe to the same three tables simultaneously:

| Channel | File | Line | Callback |
|---------|------|------|----------|
| `collaboration_pill_changes_${userId}` | `app/index.tsx` | 434 | `refreshAllSessions()` |
| `collaboration-updates-${userId}` | `hooks/useSessionManagement.ts` | 1188 | `loadUserSessions()` |

Both are active because `useSessionManagement()` is called inside `RecommendationsContext` (line 139 of `RecommendationsContext.tsx`), which wraps the entire app. Once we enable the realtime publication, **every single event will trigger BOTH channels**, causing:
- Double data fetches (both `refreshAllSessions()` and `loadUserSessions()` query the same tables)
- Race conditions between two independent refresh cycles
- Wasted bandwidth and battery

**Decision: Remove the realtime channel from `index.tsx` (lines 416-477).** Keep the one in `useSessionManagement.ts` because:
1. `useSessionManagement` is the canonical owner of session state — its `loadUserSessions()` updates `sessionState` which is consumed by `RecommendationsContext`, `SessionSwitcher`, `NotificationBar`, `ModeToggleButton`, `SwipeableCards`, and `OnboardingCollaborationStep`.
2. The `refreshAllSessions()` function in `index.tsx` updates `boardsSessions` (a separate state variable), which feeds `CollaborationSessions` pills. But `boardsSessions` duplicates data already in `useSessionManagement` — they both query the same tables. The pills should read from `useSessionManagement` state instead.
3. However, `refreshAllSessions()` has extra logic (inviter profile lookups, generation-based stale protection) that `loadUserSessions()` also has independently.

**Simplest safe fix (avoids large refactor):** Remove the realtime subscription from `index.tsx` lines 416-477 entirely. Keep the `AppState` foreground listener (lines 484-506) that calls `refreshAllSessions()` — this is a safety net for reconnection gaps and costs nothing when idle. The `useSessionManagement` channel becomes the single source of realtime-driven refreshes, and `refreshAllSessions()` is only called on foreground resume.

**To keep pills in sync:** After `useSessionManagement.loadUserSessions()` completes (via realtime), it must also trigger `refreshAllSessions()` on index.tsx. The cleanest way: add an `onSessionsChanged` callback prop to `useSessionManagement` and call it after each successful load. Index.tsx passes `refreshAllSessions` as this callback.

**However** — this creates coupling. The even simpler approach: just keep `refreshAllSessions()` called from the `AppState` listener and rely on `useSessionManagement`'s realtime to update its own state. The pills that depend on `boardsSessions` will update slightly slower (only on foreground resume), but the `useSessionManagement` consumers will update in realtime. Given the complexity trade-off, choose this approach.

**FINAL DECISION — cleanest path:**

#### 6.1.1 Remove the realtime subscription from `index.tsx`

**File:** `app-mobile/app/index.tsx`
**What to remove:** Lines 392-477 (the `realtimeRefreshDebounceRef`, the `collaboration_pill_changes` channel subscription useEffect, and the stale closure comment block).
**Keep:** Lines 484-506 (AppState foreground listener calling `refreshAllSessions()`).

**Why:** The `useSessionManagement` hook already has a comprehensive realtime subscription (lines 1187-1247) that covers the same three tables with proper debouncing. Removing the duplicate prevents double-fetch when realtime is enabled.

#### 6.1.2 Wire `useSessionManagement` realtime events to also refresh `boardsSessions`

The `boardsSessions` state in `index.tsx` feeds the `CollaborationSessions` pill bar. Currently it's refreshed by `refreshAllSessions()`. To keep pills live without the removed channel, add a lightweight bridge:

**File:** `app-mobile/app/index.tsx`

After the `useSessionManagement` realtime fires and updates its state, the `RecommendationsContext` re-renders, which means `index.tsx` re-renders. Add a `useEffect` that watches the `useSessionManagement` session data and calls `refreshAllSessions()` when it changes.

**But wait** — `index.tsx` doesn't directly use `useSessionManagement`. It gets session data passed down differently. Let me trace the actual data flow.

**Actual data flow for pills:**
- `index.tsx` maintains `boardsSessions` state (line ~200)
- `refreshAllSessions()` populates it (line 848: `updateBoardsSessions(uniqueSessions)`)
- `boardsSessions` is transformed to `collaborationSessions` (line 365)
- `collaborationSessions` is passed to `<HomePage collaborationSessions={...} />`
- `HomePage` passes it to `<CollaborationSessions sessions={collaborationSessions} />`

**`useSessionManagement` data flow:**
- `useSessionManagement` maintains its own `sessionState.availableSessions`
- Used by `RecommendationsContext` for `currentSession` and `isInSolo`
- Used by `SessionSwitcher` for session list
- **NOT used for the pill bar** — pills come from `boardsSessions`

**Therefore:** The pill bar and `useSessionManagement` are **independent state trees**. Removing the index.tsx realtime channel means pills only update on foreground resume (AppState) or explicit calls to `refreshAllSessions()`. This is the same "slow" behavior the user reported.

**REVISED DECISION:** Do NOT remove the index.tsx channel. Instead, **remove the `useSessionManagement.ts` channel** (lines 1187-1247) and keep the index.tsx one, since the pill bar is the primary user-facing element. Then make `useSessionManagement.loadUserSessions()` called from the same trigger.

**Actually — the simplest correct fix is:**

Keep BOTH channels but understand they serve different state trees:
- `index.tsx` channel → `refreshAllSessions()` → `boardsSessions` → pill bar
- `useSessionManagement` channel → `loadUserSessions()` → `sessionState` → session switcher, recommendations

Both will fire on the same events, but they update different state. The "double fetch" is actually two different fetch functions populating two different state trees — this is correct behavior, not waste. Each function queries slightly different data.

**FINAL FINAL DECISION:** Keep both channels. The double-fetch is intentional — they serve different consumers. The cost is acceptable (2 parallel DB reads instead of 1, debounced).

### 6.2 Files to Modify

#### 6.2.1 Fix the un-debounced invite handler in `useSessionManagement.ts`

**File:** `app-mobile/src/hooks/useSessionManagement.ts`
**Where:** Lines 1211-1223
**Problem:** When a new invite INSERT targets this user, `loadUserSessions()` is called immediately without debounce. If 3 invites arrive within 200ms (e.g., user is invited to 3 sessions simultaneously), this fires 3 unthrottled `loadUserSessions()` calls, each running 7+ DB queries.

**Change this:**
```typescript
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'collaboration_invites',
          filter: `invitee_id=eq.${user.id}`
        },
        () => {
          // New invite targeting this user — reload immediately (no debounce)
          // so the collaboration pill appears as fast as possible.
          loadUserSessions();
        }
      )
```

**To this:**
```typescript
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'collaboration_invites',
          filter: `invitee_id=eq.${user.id}`
        },
        () => {
          // New invite targeting this user — use a short debounce (200ms)
          // to batch multiple simultaneous invites while still feeling instant.
          // 200ms is imperceptible to users but prevents thundering herd when
          // multiple invitations arrive in rapid succession.
          debouncedReload();
        }
      )
```

**Why:** The existing 300ms debounce in `debouncedReload()` batches rapid events. The pill still appears within ~500ms (300ms debounce + ~200ms query), which is well within the 2-second success criterion. The "immediate" call was an optimization that becomes a liability once realtime is actually enabled.

#### 6.2.2 Add notification catch-up on foreground resume

**File:** `app-mobile/app/index.tsx`
**Where:** Inside the AppState foreground listener (lines 484-506)
**Problem:** When the app resumes from background, `refreshAllSessions()` fetches pending invites and updates pills, but never creates in-app notifications for invites that arrived while the app was in background.

**Add a `notifiedCollabInviteIdsRef`** (similar to the existing `notifiedFriendRequestIdsRef` pattern at line ~184):

**Add after the existing `notifiedFriendRequestIdsRef` declaration:**
```typescript
// Tracks collaboration invite IDs that have already generated in-app notifications.
// Prevents duplicates when the same invite is seen by both the push handler and
// the foreground catch-up mechanism.
const notifiedCollabInviteIdsRef = useRef<Set<string>>(new Set());
```

**Modify the `processNotification` function** (line 293) to record the invite ID:
```typescript
        case "collaboration_invite_received":
          // Record this invite ID to prevent duplicate notification on foreground catch-up
          if (data.inviteId) {
            notifiedCollabInviteIdsRef.current.add(data.inviteId as string);
          }
          inAppNotificationService.notifyCollaborationInvite(
            (data.sessionName as string) || "a session",
            (data.inviterName as string) || "Someone",
            data.sessionId as string,
            data.inviteId as string,
            data.inviterAvatarUrl as string | undefined
          );
          break;
```

**Add the catch-up function** as a new `useEffect` after the AppState listener (after line 506):

```typescript
  // Collaboration invite notification catch-up on foreground resume.
  // When the app returns from background, pending invites may exist in the DB
  // that never generated an in-app notification (push arrived while app was killed,
  // or push was missed entirely). This effect queries pending invites and creates
  // notifications for any not yet tracked by notifiedCollabInviteIdsRef.
  //
  // This mirrors the existing friend request notification pattern (lines 540-577).
  useEffect(() => {
    if (!user?.id) return;

    const catchUpCollabNotifications = async () => {
      try {
        const { data: pendingInvites } = await supabase
          .from('collaboration_invites')
          .select(`
            id,
            session_id,
            inviter_id,
            invited_by,
            status,
            collaboration_sessions!inner(name),
            profiles!collaboration_invites_invited_by_fkey(display_name, first_name, username, avatar_url)
          `)
          .eq('invited_user_id', user.id)
          .eq('status', 'pending');

        if (!pendingInvites || pendingInvites.length === 0) return;

        for (const invite of pendingInvites) {
          if (notifiedCollabInviteIdsRef.current.has(invite.id)) continue;

          const session = invite.collaboration_sessions as any;
          const inviterProfile = invite.profiles as any;
          const sessionName = session?.name || 'a session';
          const inviterName =
            inviterProfile?.display_name ||
            inviterProfile?.first_name ||
            inviterProfile?.username ||
            'Someone';

          await inAppNotificationService.notifyCollaborationInvite(
            sessionName,
            inviterName,
            invite.session_id,
            invite.id,
            inviterProfile?.avatar_url
          );
          notifiedCollabInviteIdsRef.current.add(invite.id);
        }
      } catch (err) {
        console.warn('[CollabCatchUp] Failed to catch up notifications:', err);
      }
    };

    // Run once on mount (covers app launch after receiving pushes while killed)
    catchUpCollabNotifications();

    // Run on foreground resume
    const subscription = AppState.addEventListener(
      'change',
      (nextState: AppStateStatus) => {
        if (
          (appStateRef.current === 'background' || appStateRef.current === 'inactive') &&
          nextState === 'active'
        ) {
          catchUpCollabNotifications();
        }
      },
    );

    return () => {
      subscription.remove();
    };
  }, [user?.id]);
```

**Why this is safe:**
- `notifiedCollabInviteIdsRef` is populated both by the push handler (foreground pushes) and the catch-up mechanism itself
- No duplicates possible: `if (notifiedCollabInviteIdsRef.current.has(invite.id)) continue`
- The ref persists across re-renders but resets on app kill (acceptable — catch-up will re-query and re-notify, but the notifications will have different `notif_*` IDs so the user sees them fresh, which is correct behavior after app kill)
- The query uses `invited_user_id` (not `invitee_id`) to match the `refreshAllSessions` pattern at line 746. Verify which column name is correct for the recipient — the schema has both `invitee_id` and `invited_user_id` due to migration history. The RLS policy checks both: `auth.uid() = invitee_id OR auth.uid() = invited_user_id`. Use whichever column `refreshAllSessions` uses (line 746: `invited_user_id`).

#### 6.2.3 Clean up `notifiedCollabInviteIdsRef` on invite acceptance/decline

**File:** `app-mobile/app/index.tsx` (or `app-mobile/src/components/HomePage.tsx`)
**Where:** In `handleAcceptCollabInvite` (HomePage.tsx line 191) and `handleDeclineCollabInvite` (line 218)

After the invite status changes, remove the ID from the ref so it doesn't leak memory:

This is NOT strictly necessary (the Set grows by at most ~50 entries per session and resets on app restart), but for 100% cleanliness:

**In `handleAcceptCollabInvite`, after `await inAppNotificationService.remove(notificationId)` (line 211):**
The ref lives in index.tsx, not HomePage. Since HomePage receives callbacks as props, the cleanest approach is to NOT touch the ref from HomePage. The ref is only for deduplication within a single app session — accepted/declined invites won't be re-fetched by the catch-up query (they have `status != 'pending'`), so they'll never create duplicates anyway.

**No change needed.** The catch-up query filters `status='pending'`, and accepted/declined invites are no longer pending. Self-cleaning.

#### 6.2.4 Realtime filter column consolidation

**Superseded by §6.3.** Once all app code uses `invited_user_id` exclusively (§6.3.1) and the DB trigger is updated to insert `invited_user_id` (§4.4 Step 5), all realtime filters and all insert paths use the same column. No dual-handler workaround is needed.

After §6.3 is applied:
- `useSessionManagement.ts` line 1217: filter will be `invited_user_id=eq.${user.id}` (single handler)
- `index.tsx` line 460: filter will be `invited_user_id=eq.${userId}` (already correct, single handler)
- `CollaborationModule.tsx` line 151: filter will be `invited_user_id=eq.${user.id}` (single handler)
- `OnboardingCollaborationStep.tsx` line 107: filter will be `invited_user_id=eq.${userId}` (single handler)

No second handler for `invitee_id` is needed because `invitee_id` will no longer exist after the migration.

### 6.3 Consolidate App Code: Replace All `invitee_id` → `invited_user_id` and `invited_by` → `inviter_id`

This is the prerequisite for the database migration in §4.4. Every reference to the alias columns must be replaced with the canonical column BEFORE the migration drops them.

**IMPORTANT:** This is a mechanical find-and-replace, but each occurrence must be verified in context. The implementor must NOT blindly replace — some occurrences are in comments, type definitions, or FK alias names that need different handling.

#### 6.3.1 Replace `invitee_id` → `invited_user_id` (13 occurrences across 4 files)

**File: `app-mobile/src/hooks/useSessionManagement.ts`** (8 occurrences)

All `.eq('invitee_id', ...)` queries must become `.eq('invited_user_id', ...)`:
- Line 175: `.eq('invitee_id', user.id)` → `.eq('invited_user_id', user.id)`
- Line 753: `.eq('invitee_id', user.id)` → `.eq('invited_user_id', user.id)`
- Line 961: `.eq('invitee_id', user.id)` → `.eq('invited_user_id', user.id)`
- Line 1086: `.eq('invitee_id', user.id)` → `.eq('invited_user_id', user.id)`
- Line 1138: `.eq('invitee_id', user.id)` → `.eq('invited_user_id', user.id)`
- Line 1217: realtime filter `invitee_id=eq.${user.id}` → `invited_user_id=eq.${user.id}`
- Lines 1182, 1222: comments referencing `invitee_id` — update to `invited_user_id`

**File: `app-mobile/src/components/CollaborationModule.tsx`** (2 occurrences)

- Line 151: realtime filter `invitee_id=eq.${user.id}` → `invited_user_id=eq.${user.id}`
- Line 163: realtime filter `inviter_id=eq.${user.id}` — this one stays as-is (`inviter_id` is canonical)

**File: `app-mobile/src/components/onboarding/OnboardingCollaborationStep.tsx`** (2 occurrences)

- Line 107 (or nearby): realtime filter `invitee_id=eq.${userId}` → `invited_user_id=eq.${userId}`
- Remove the comment that says "Use canonical column name `invitee_id`" — it's now wrong. `invited_user_id` IS the canonical column.

**File: `app-mobile/src/components/SessionViewModal.tsx`** (1 occurrence)

- Line 332: `.eq("invitee_id", user.id)` → `.eq("invited_user_id", user.id)`

#### 6.3.2 Replace `invited_by` → `inviter_id` (17 occurrences across 7 files)

**File: `app-mobile/src/components/CollaborationModule.tsx`** (8 occurrences)

All `.eq('invited_by', ...)` and select/insert references:
- Line 190 (FK alias in select): `profiles!collaboration_invites_invited_by_fkey(...)` — This is a **Supabase FK relationship alias**, not a column name. After the column is dropped, this FK alias will break. **The implementor must update the FK reference.** However, dropping the `invited_by` column also drops its FK constraint. The query must use the `inviter_id` FK instead: `profiles!collaboration_invites_inviter_id_fkey(...)`. Verify the actual FK constraint name in the database.
- All other occurrences: replace `.eq('invited_by', ...)` with `.eq('inviter_id', ...)`
- Replace all `inv.invited_by` field accesses with `inv.inviter_id`

**File: `app-mobile/src/components/board/InviteParticipantsModal.tsx`** (1 occurrence)

- Line ~178: insert object `{ invited_by: user.id, ... }` → `{ inviter_id: user.id, ... }`

**File: `app-mobile/src/components/CreateSessionModal.tsx`** (1 occurrence)

- Insert object `{ invited_by: ..., ... }` → `{ inviter_id: ..., ... }`

**File: `app-mobile/src/components/HomePage.tsx`** (2 occurrences)

- Line ~225: `.select("invited_by, ...")` → `.select("inviter_id, ...")`
- Line ~240: `invite.invited_by` → `invite.inviter_id`

**File: `app-mobile/src/hooks/useRealtimeSession.ts`** (1 occurrence)

- FK alias in select: `profiles!collaboration_invites_invited_by_fkey(...)` → `profiles!collaboration_invites_inviter_id_fkey(...)`

**File: `app-mobile/src/services/boardInviteService.ts`** (3 occurrences)

- All insert objects: `{ invited_by: ..., ... }` → `{ inviter_id: ..., ... }`
- Select queries: `invited_by` column references → `inviter_id`
- FK alias: `profiles!collaboration_invites_invited_by_fkey(...)` → use the `inviter_id` FK alias

**File: `app-mobile/src/types/index.ts`** (1 occurrence)

- Type definition: `invited_by?: string` → remove this field, keep only `inviter_id`
- Also: `invited_user_id?: string` → remove optional marker if present, this is now the canonical required field. Keep `invitee_id` removed from the type.

#### 6.3.3 Update TypeScript types

**File: `app-mobile/src/types/index.ts`**

Find the `CollaborationInvite` type (or whatever the invite type is named) and ensure it has exactly these participant fields:
```typescript
  inviter_id: string;       // UUID of the person who sent the invite
  invited_user_id: string;  // UUID of the person being invited
```

Remove any references to `invitee_id` or `invited_by` from all TypeScript interfaces.

#### 6.3.4 Verify: FK alias names after column drop

When `invited_by` is dropped, its FK constraint (`collaboration_invites_invited_by_fkey`) is also dropped. Any Supabase `.select()` query that uses `profiles!collaboration_invites_invited_by_fkey(...)` will fail.

The replacement FK alias depends on the actual constraint name for `inviter_id`. The original CREATE TABLE created `inviter_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE`, which auto-generates a constraint named approximately `collaboration_invites_inviter_id_fkey`.

**The implementor must verify this constraint name** by running:
```sql
SELECT conname FROM pg_constraint
WHERE conrelid = 'public.collaboration_invites'::regclass
AND confrelid = 'auth.users'::regclass;
```

Use the actual constraint name in all Supabase `.select()` join aliases.

Similarly, when `invitee_id` is dropped, its FK (`collaboration_invites_invitee_id_fkey` or similar) is dropped. Any query using that FK alias must switch to the `invited_user_id` FK constraint name.

### 6.4 State Changes

**Zustand:** No changes.
**React Query:** No changes.
**Local state:**
- New `notifiedCollabInviteIdsRef` ref in `index.tsx` (Set<string>)
- No other state changes.

---

## 7. Implementation Order

**CRITICAL SEQUENCING:** Steps 1-4 (app code) must be deployed BEFORE Step 5 (column drop migration). If the migration runs while app code still references `invitee_id` or `invited_by`, queries will crash with "column does not exist." The realtime publication migration (Step 5) can run at any time — it only enables events that existing code already handles.

**Step 1: Consolidate app code — replace all alias column references.**
Apply §6.3 in full. Replace every `invitee_id` → `invited_user_id` and every `invited_by` → `inviter_id` across all files listed in §6.3.1 and §6.3.2. Update TypeScript types (§6.3.3). Verify FK alias names (§6.3.4). Update the `delete-user` edge function (§5.2).

Verify: `grep -r "invitee_id\|invited_by" app-mobile/src/ supabase/functions/` returns zero matches (excluding comments and this spec file). Every query, insert, filter, and type reference uses the canonical columns only.

**Step 2: Debounce the invite INSERT handler in `useSessionManagement.ts`.**
Apply §6.2.1. Change `loadUserSessions()` to `debouncedReload()` on line 1222. This prevents thundering herd once realtime is enabled in Step 5.

**Step 3: Add the `notifiedCollabInviteIdsRef` and catch-up mechanism in `index.tsx`.**
Apply §6.2.2. Add the ref declaration, modify `processNotification`, and add the new `useEffect`. This ensures in-app notifications are created even when pushes are missed.

**Step 4: Deploy app code.**
Ship the mobile app update with Steps 1-3. All users must be on this version before Step 5-6 run. If using OTA updates (Expo), ensure the update is live and adopted.

**Step 5: Run the realtime publication migration.**
Copy the SQL from §4.2 and execute it via `supabase/migrations/[timestamp]_add_collaboration_tables_to_realtime.sql`. Verify: In the Supabase dashboard → Database → Publications → `supabase_realtime`, confirm `collaboration_invites`, `collaboration_sessions`, and `session_participants` appear in the table list.

**Step 6: Run the column consolidation migration.**
Copy the SQL from §4.4 and execute it. This drops the alias columns, sync triggers, and updates RLS policies. Verify: `SELECT column_name FROM information_schema.columns WHERE table_name = 'collaboration_invites' ORDER BY ordinal_position;` — should show `id`, `session_id`, `inviter_id`, `invited_user_id`, `status`, `created_at`, `updated_at` and NO `invitee_id` or `invited_by`.

**Step 7: Integration test.**
Follow the test cases in §8.

---

## 8. Test Cases

| # | Test | Input | Expected Output | Layer |
|---|------|-------|-----------------|-------|
| 1 | Realtime pill appearance | User A invites User B (B's app is open on home screen) | B's grey pill appears within 2 seconds | Mobile + DB |
| 2 | In-app notification (foreground) | User A invites User B (B's app is open) | B's bell icon badge increments, notification appears in NotificationsModal with accept/decline buttons | Mobile |
| 3 | Push notification (background) | User A invites User B (B's app is in background) | B receives a push notification on lock screen with title "New Collaboration Invite" | Edge Function + OneSignal |
| 4 | In-app notification catch-up (background) | User A invites User B (B's app is in background). B opens app WITHOUT tapping the push. | B's bell icon shows the notification. Grey pill is visible. | Mobile |
| 5 | No duplicate notifications | User A invites User B (B's app is in foreground). Push arrives AND catch-up runs on next foreground cycle. | Only ONE notification in NotificationsModal, not two | Mobile |
| 6 | Rapid invites batching | Users A, B, C invite User D within 200ms | D sees 3 grey pills and 3 notifications, but `loadUserSessions()` is called at most 2 times (debounce batching) | Mobile |
| 7 | Accept from notification | User B taps "Accept" on collaboration invite notification | Invite status changes to 'accepted', notification is removed, session becomes active pill | Mobile + DB |
| 8 | Decline from notification | User B taps "Decline" on collaboration invite notification | Invite status changes to 'declined', notification is removed, grey pill disappears | Mobile + DB |
| 9 | Killed app + relaunch | User A invites User B. B's app is killed. B opens app fresh. | Catch-up mechanism creates notification, grey pill appears | Mobile |
| 10 | Column filter coverage | DB trigger creates invite via phone conversion | Realtime fires (trigger now inserts `invited_user_id`), pill appears for recipient | Mobile + DB |
| 11 | Column drop safety | Query `collaboration_invites` with all app code paths after migration | No "column does not exist" errors. All queries, inserts, selects, and realtime filters work with `invited_user_id` and `inviter_id` only | DB + Mobile |
| 12 | RLS after column drop | Unauthenticated user queries `collaboration_invites` | Permission denied. Authenticated user sees only their own invites (as inviter or invitee) | DB |
| 13 | User deletion cleanup | Delete a user who has sent and received invites | All related `collaboration_invites` rows deleted via CASCADE on both `inviter_id` and `invited_user_id` FKs | DB |
| 14 | FK join alias | Supabase `.select()` with `profiles!collaboration_invites_inviter_id_fkey(...)` join | Returns inviter profile correctly. No FK alias errors. | Mobile + DB |

---

## 9. Common Mistakes to Avoid

1. **Mistake: Forgetting the publication migration.** The mobile code changes are useless without the `ALTER PUBLICATION` migration. If you deploy mobile changes first, nothing changes — the realtime subscriptions still receive zero events. → **Correct approach:** Deploy the migration FIRST (or simultaneously). The mobile code is already written to handle these events; it's just been listening to silence.

2. **Mistake: Running the column drop migration before deploying the app code update.** If the migration drops `invitee_id` while any user's app still references it, their queries crash. → **Correct approach:** Deploy app code first (Step 4), wait for adoption, THEN run the migration (Step 6). If using OTA, verify the update is live.

3. **Mistake: Creating the catch-up notification without deduplication.** If you query pending invites on foreground resume and call `notifyCollaborationInvite()` without checking the ref, you'll create duplicates of notifications already created by the foreground push handler. → **Correct approach:** Always check `notifiedCollabInviteIdsRef.current.has(invite.id)` before creating.

4. **Mistake: Removing the debounce from the invite INSERT handler "for speed".** The un-debounced `loadUserSessions()` call at line 1222 was written when realtime was broken (zero events), so it never fired. Once realtime is enabled, it becomes a thundering herd. → **Correct approach:** Use `debouncedReload()`. The 300ms debounce is imperceptible to users.

5. **Mistake: Removing one of the two realtime channels thinking they're redundant.** They serve different state trees (`boardsSessions` for pills vs `sessionState` for recommendations/switcher). Removing either breaks its consumer. → **Correct approach:** Keep both. The "double fetch" is two different functions populating two different state trees. The debounce makes the cost acceptable.

6. **Mistake: Forgetting to update Supabase FK join aliases.** After dropping `invited_by`, any `.select()` using `profiles!collaboration_invites_invited_by_fkey(...)` will fail. The error message ("Could not find a relationship") is cryptic and easy to miss in testing if the join is in a secondary code path. → **Correct approach:** Search for ALL occurrences of `collaboration_invites_invited_by_fkey` and replace with the `inviter_id` FK constraint name. Verify the actual constraint name from the database before replacing.

7. **Mistake: Not updating the `convert_pending_invites_on_phone_verified` trigger.** This DB trigger inserts into `invitee_id`. If the column is dropped without updating the trigger, phone invite conversion silently fails (INSERT into non-existent column). → **Correct approach:** The migration in §4.4 Step 5 rewrites the trigger to use `invited_user_id`. Do not skip this step.

---

## 10. Risk Assessment

### Will it drift under pressure?
**No.** The publication is a one-time DB change. The deduplication ref (`notifiedCollabInviteIdsRef`) is stateless across app restarts — it catches up fresh each launch. The debounce timer is self-cleaning (clearTimeout on unmount).

### Will it break something else?
**Low risk.** The migration enables realtime events that existing code already expects. The only behavior change is that dead subscriptions start working. All callbacks are read-only fetches (no writes back to the same tables), so no infinite loops. Verified: no subscription callback in the codebase writes to `collaboration_invites`, `collaboration_sessions`, or `session_participants`.

### Will it prove to be a problem later?
**No.** The dual-column issue (`invitee_id`/`invited_user_id` and `inviter_id`/`invited_by`) is permanently resolved by the column consolidation migration in §4.4. After this spec is fully implemented, the table has exactly two participant columns with no aliases, no sync triggers, and no ambiguity. Future developers have one column name to use for each role — period.

**Deployment gap risk:** Between app code deployment (Step 4) and column drop migration (Step 6), the old columns still exist but are no longer written to by the app. The sync triggers still run during this window, so both columns stay populated. Old app versions (pre-update) continue to work because the triggers sync their writes to the canonical columns. This window is safe.

### Performance under load?
With 3 friends invited: 8 realtime events → debounced to 1-2 `refreshAllSessions()` calls (index.tsx, 500ms debounce) + 1-2 `loadUserSessions()` calls (useSessionManagement, 300ms debounce). Total: ~4 parallel DB round-trips. Acceptable.

With 10 friends invited: ~20 events → still debounced to 1-2 calls each. The debounce window absorbs the burst. No scaling concern.

---

## 11. Handoff to Implementor

Implementor: this document is your single source of truth. Execute it top to bottom, in the exact order specified in §7. Do not skip steps. Do not reorder steps. Do not add features, refactor adjacent code, or "improve" anything outside the scope of this spec. Every file path, function signature, type definition, SQL statement, and validation rule in this document is intentional and exact — copy them precisely. If something in this spec is unclear or seems wrong, stop and ask before improvising. When you are finished, produce your IMPLEMENTATION_REPORT.md referencing each section of this spec to confirm compliance, then hand the implementation to the tester. Your work is not done until the tester's report comes back green.

# Feature: Unified Platform Stability & Discover Friend Link Redesign
**Date:** 2026-03-12
**Status:** Planned
**Supersedes:** FEATURE_NOTIFICATION_SYSTEM_FIX_SPEC.md, FEATURE_INFINITE_LOADER_FIX_SPEC.md, FEATURE_BOARD_COLLABORATORS_SPEC.md, FEATURE_ACCOUNT_DELETION_FIX_SPEC.md

---

## 1. Summary

This spec consolidates 19 confirmed bugs across 5 previously written specs, 4 new bugs discovered
through forensic log analysis, and 1 new feature (incoming friend link request pills on Discover).
The root cause of the entire collaboration system failure — the missing `board_collaborators` table —
is addressed first. Every other fix is layered on top in strict dependency order. The spec covers
2 new database migrations, 8 edge function changes, and 16 mobile file modifications. No scope
creep. Every change listed here is load-bearing.

---

## 2. User Stories

1. **As a user who signed up with only a phone number**, I want push notifications delivered so that I
   am not silently invisible to the system.
2. **As a collaboration session participant**, I want accepting an invite to complete atomically so
   that both sides see the session as active with the board created correctly.
3. **As the person who sent a collaboration invite**, I want the pill on my home screen to turn active
   once the invitee accepts so that I am not left staring at a grey pill forever.
4. **As a user on the Discover "For You" tab**, I want incoming friend link requests to appear as grey
   pills in the person pill row so that I discover and act on them in context, not buried in a modal.
5. **As a user who accepts a link request**, I want to immediately see the PersonHolidayView for that
   person so that I understand the value of linking right away.
6. **As a user deleting their account**, I want the deletion to complete reliably within the timeout
   so that I am not left in a half-deleted state.
7. **As a developer**, I want push tokens for uninstalled devices automatically purged so that
   notifications never fail silently to ghost devices.
8. **As a user navigating the app**, I want authentication to initialize once at startup — not on
   every tab switch — so that the app feels fast and predictable.

---

## 3. Success Criteria

1. A user with only a phone number (no email) receives push notifications for messages and friend
   requests.
2. Accepting a collaboration invite writes a record to `board_collaborators` without error; both
   sides see the session as active immediately after.
3. The grey collaboration pill on the home screen turns active for the inviter within 5 seconds of
   the invitee accepting.
4. Pending incoming friend link requests appear as grey pills in the Discover "For You" pill row
   alongside saved people.
5. Tapping an incoming request pill shows an inline card with the requester's name, avatar, a
   brief description, and Accept/Decline buttons — animated in with fade + slide-up (400ms).
6. Tapping Accept transitions immediately to PersonHolidayView for that person.
7. The `LinkRequestBanner` component is no longer rendered anywhere in the Discover screen.
8. Link requests do not appear in the ConnectionsPage RequestsView. Only legacy friend requests
   appear there.
9. Tapping a push notification of type `friend_link_request` opens the Discover tab with the "For
   You" pill active, not the Connections tab.
10. Account deletion completes in under 15 seconds for a user with up to 10 collaboration sessions.
11. After account deletion, no stale JWT operations occur — the client is signed out the moment
    auth.users is deleted.
12. `[AUTH] Initializing — fetching session...` appears in the log exactly ONCE on app startup, not
    once per component mount.
13. After a session of normal use (5 tab switches), the auth state change log shows at most 2
    INITIAL_SESSION events — not 6-8.
14. Expo push errors of type `DeviceNotRegistered` result in the stale token being deleted from
    `user_push_tokens` within the same edge function call.
15. After two users link, the pill for the accepted person shows their real display name, not a
    phone number.

---

## 4. Database Changes

### 4.1 New Table: `board_collaborators`

This table is the root cause of the collaboration system failure. Six mobile files reference it;
zero migrations create it. Create it now.

```sql
-- Migration: 20260312000001_create_board_collaborators.sql
-- Description: Creates the board_collaborators table that tracks which users have access
-- to a shared board and in what role. Referenced by 6 mobile files since day one but
-- never created in any prior migration. The INSERT policy deliberately checks session
-- membership rather than identity — the accepting user inserts rows for ALL participants
-- including the session creator, so auth.uid() = user_id would silently block owner rows.

CREATE TABLE public.board_collaborators (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id      UUID        NOT NULL REFERENCES public.boards(id) ON DELETE CASCADE,
  user_id       UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role          TEXT        NOT NULL DEFAULT 'collaborator'
                            CHECK (role IN ('owner', 'collaborator')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (board_id, user_id)
);

-- Index for the most common query pattern: "all collaborators for a given board"
CREATE INDEX idx_board_collaborators_board_id
  ON public.board_collaborators(board_id);

-- Index for reverse lookup: "all boards a user collaborates on"
CREATE INDEX idx_board_collaborators_user_id
  ON public.board_collaborators(user_id);

ALTER TABLE public.board_collaborators ENABLE ROW LEVEL SECURITY;

-- SELECT: Any collaborator on the board can see all other collaborators on that board.
-- The subquery checks whether the requesting user is already a collaborator on that board.
CREATE POLICY "Collaborators can view board collaborators"
  ON public.board_collaborators FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.board_collaborators bc2
      WHERE bc2.board_id = board_collaborators.board_id
        AND bc2.user_id = auth.uid()
    )
  );

-- INSERT: Must check that the inserting user is a participant in the session that owns
-- the board. Using auth.uid() = user_id here would block the owner row — the accepting
-- user inserts all rows including the creator's. Session membership is the correct gate.
CREATE POLICY "Session participants can insert board collaborators"
  ON public.board_collaborators FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.collaboration_sessions cs
      JOIN public.session_participants sp
        ON sp.session_id = cs.id
      WHERE cs.board_id = board_collaborators.board_id
        AND sp.user_id = auth.uid()
        AND sp.has_accepted = TRUE
    )
  );

-- UPDATE: Only the collaborator themselves or the board owner can update a row.
CREATE POLICY "Collaborators can update their own row"
  ON public.board_collaborators FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- DELETE: Collaborators can remove themselves. Owners can remove anyone.
CREATE POLICY "Collaborators can delete their own row or owner can delete any"
  ON public.board_collaborators FOR DELETE
  USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1
      FROM public.board_collaborators bc_owner
      WHERE bc_owner.board_id = board_collaborators.board_id
        AND bc_owner.user_id = auth.uid()
        AND bc_owner.role = 'owner'
    )
  );
```

### 4.2 New Table: `notification_preferences`

The `smartNotificationService.ts` references this table in 3 places. It has never existed. Users
have had no way to control their notification settings since the feature was built.

```sql
-- Migration: 20260312000002_create_notification_preferences.sql
-- Description: Creates per-user notification preferences table. All fields default to
-- true (opt-in by default). The service already references this table; this migration
-- makes the data layer exist.

CREATE TABLE public.notification_preferences (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID        NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  push_enabled          BOOLEAN     NOT NULL DEFAULT TRUE,
  email_enabled         BOOLEAN     NOT NULL DEFAULT TRUE,
  friend_requests       BOOLEAN     NOT NULL DEFAULT TRUE,
  link_requests         BOOLEAN     NOT NULL DEFAULT TRUE,
  messages              BOOLEAN     NOT NULL DEFAULT TRUE,
  collaboration_invites BOOLEAN     NOT NULL DEFAULT TRUE,
  marketing             BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notification_preferences_user_id
  ON public.notification_preferences(user_id);

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read their own preferences"
  ON public.notification_preferences FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own preferences"
  ON public.notification_preferences FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own preferences"
  ON public.notification_preferences FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own preferences"
  ON public.notification_preferences FOR DELETE
  USING (auth.uid() = user_id);

-- Trigger: auto-update updated_at on every row change
CREATE OR REPLACE FUNCTION update_notification_preferences_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER notification_preferences_updated_at
  BEFORE UPDATE ON public.notification_preferences
  FOR EACH ROW EXECUTE FUNCTION update_notification_preferences_updated_at();
```

### 4.3 RLS Policy Summary

| Table | Policy | Operation | Rule |
|-------|--------|-----------|------|
| board_collaborators | Collaborators can view board collaborators | SELECT | Requesting user is in board_collaborators for same board |
| board_collaborators | Session participants can insert board collaborators | INSERT | Inserting user is an accepted session_participant for the session that owns the board |
| board_collaborators | Collaborators can update their own row | UPDATE | auth.uid() = user_id |
| board_collaborators | Collaborators can delete their own row or owner can delete any | DELETE | auth.uid() = user_id OR user is owner of that board |
| notification_preferences | Users can read their own preferences | SELECT | auth.uid() = user_id |
| notification_preferences | Users can insert their own preferences | INSERT | auth.uid() = user_id |
| notification_preferences | Users can update their own preferences | UPDATE | auth.uid() = user_id |
| notification_preferences | Users can delete their own preferences | DELETE | auth.uid() = user_id |

---

## 5. Edge Function Changes

### 5.1 New Shared Utility: `supabase/functions/_shared/push-utils.ts`

**Purpose:** Centralise Expo push sending across all 8 functions that currently call the Expo API
directly. This utility sends the push, reads the response, detects `DeviceNotRegistered` errors,
and deletes the stale token. Currently none of the 8 functions read the Expo response at all.

**File path:** `supabase/functions/_shared/push-utils.ts`

```typescript
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

interface PushPayload {
  to: string;                // Expo push token
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: "default" | null;
  badge?: number;
}

interface ExpoTicket {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
}

interface ExpoPushResponse {
  data: ExpoTicket[];
}

/**
 * Sends a push notification via Expo and purges the token if it is stale.
 *
 * Call this instead of calling fetch("https://exp.host/...") directly.
 * Returns true if the push was accepted, false if the token was stale or delivery failed.
 */
export async function sendPush(
  supabaseUrl: string,
  supabaseServiceKey: string,
  payload: PushPayload
): Promise<boolean> {
  let response: Response;

  try {
    response = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "Accept-Encoding": "gzip, deflate",
      },
      body: JSON.stringify(payload),
    });
  } catch (networkErr) {
    console.warn("[push-utils] Network error sending push:", networkErr);
    return false;
  }

  if (!response.ok) {
    console.warn("[push-utils] Expo returned HTTP", response.status);
    return false;
  }

  let body: ExpoPushResponse;
  try {
    body = await response.json();
  } catch {
    // Cannot parse response — treat as delivered (non-critical)
    return true;
  }

  const ticket = body?.data?.[0];
  if (!ticket) return true;

  if (ticket.status === "error" && ticket.details?.error === "DeviceNotRegistered") {
    console.warn("[push-utils] DeviceNotRegistered for token, purging:", payload.to);
    // Purge the stale token from the database
    try {
      const admin = createClient(supabaseUrl, supabaseServiceKey);
      await admin
        .from("user_push_tokens")
        .delete()
        .eq("token", payload.to);
    } catch (purgeErr) {
      console.warn("[push-utils] Failed to purge stale token:", purgeErr);
    }
    return false;
  }

  return ticket.status === "ok";
}
```

### 5.2 Update All 8 Push-Sending Edge Functions

The following 8 functions all call `fetch("https://exp.host/--/api/v2/push/send", ...)` directly
and discard the response. Replace each direct `fetch` call with a call to `sendPush()` from the
shared utility above.

**Functions to update:**
1. `supabase/functions/send-collaboration-invite/index.ts`
2. `supabase/functions/send-message-email/index.ts`
3. `supabase/functions/send-friend-request-email/index.ts`
4. `supabase/functions/send-friend-link/index.ts`
5. `supabase/functions/respond-link-consent/index.ts`
6. `supabase/functions/respond-friend-link/index.ts`
7. `supabase/functions/notify-invite-response/index.ts`
8. `supabase/functions/process-referral/index.ts`

**Pattern for each function — find the direct Expo fetch and replace it:**

```typescript
// BEFORE (example from send-collaboration-invite):
try {
  await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to: token, title, body: message, data }),
  });
} catch (err) {
  console.warn("Push failed:", err);
}

// AFTER — same function, same location:
import { sendPush } from "../_shared/push-utils.ts";

await sendPush(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { to: token, title, body: message, data }
);
```

**Important for `send-friend-link/index.ts`:** This function makes 3 separate `fetch` calls to
the Expo API (lines 296, 323, 444 approximately). Replace all 3 with `sendPush()`.

The `sendPush()` function requires `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from Deno env.
These are already available in every edge function via `Deno.env.get()`.

### 5.3 Fix `delete-user`: Flip Deletion Order (Auth Before Profile)

**File:** `supabase/functions/delete-user/index.ts`

**Current order (wrong):**
- Step ~465-493: Delete `public.profiles` row
- Step ~496-515: Delete `auth.users` row

**Required order (correct):**
- Step 1: Delete `auth.users` row — this immediately invalidates the user's JWT, stopping all
  concurrent client operations (location tracking, profile fetches, etc.)
- Step 2: Delete `public.profiles` row — now safe because the JWT is already dead

**Exact change:** Find the two blocks and swap their order. The auth deletion block uses
`auth.admin.deleteUser(userId)`. The profile deletion block uses the `delete_user_profile()` RPC
with a direct-delete fallback. Move the auth deletion to run first. No other logic changes.

**Why this matters:** Currently there is a 1-2 second window where the JWT is valid but the
profile row is gone. Location tracking service calls `auth.getUser()` (succeeds), then inserts
into `user_location_history` (fails on FK constraint). Multiple `useAuthSimple` instances
simultaneously call `signOut()` when they get PGRST116 on profile fetch, producing 3+ SIGNED_OUT
events. Deleting auth first collapses this window to zero.

### 5.4 Fix `delete-user`: N+1 Query in `cleanupCollaborationSessions`

**File:** `supabase/functions/delete-user/index.ts`

**Current problem:** `cleanupCollaborationSessions()` loops over each session the user admins,
firing individual DB queries per session. For a user in 5 sessions: ~50 sequential round-trips.
The 45-second edge function timeout fires before completion.

**Required change:** Rewrite `cleanupCollaborationSessions()` to use a maximum of 9 queries
total, regardless of session count. The new logic:

```typescript
async function cleanupCollaborationSessions(
  supabase: SupabaseClient,
  userId: string
): Promise<void> {
  // 1. Fetch all sessions where user is creator — single query
  const { data: ownedSessions } = await supabase
    .from("collaboration_sessions")
    .select("id, created_by")
    .eq("created_by", userId)
    .not("status", "eq", "completed");

  if (!ownedSessions || ownedSessions.length === 0) return;

  const ownedIds = ownedSessions.map((s) => s.id);

  // 2. Fetch all participants for all owned sessions — single query
  const { data: allParticipants } = await supabase
    .from("session_participants")
    .select("session_id, user_id, has_accepted")
    .in("session_id", ownedIds)
    .neq("user_id", userId);

  if (!allParticipants) return;

  // 3. Group participants by session in memory
  const bySession = new Map<string, typeof allParticipants>();
  allParticipants.forEach((p) => {
    const arr = bySession.get(p.session_id) ?? [];
    arr.push(p);
    bySession.set(p.session_id, arr);
  });

  // 4. Determine which sessions have other accepted participants (can be transferred)
  const transferable: Array<{ sessionId: string; newOwner: string }> = [];
  const toDelete: string[] = [];

  ownedIds.forEach((sessionId) => {
    const participants = bySession.get(sessionId) ?? [];
    const accepted = participants.filter((p) => p.has_accepted);
    if (accepted.length > 0) {
      transferable.push({ sessionId, newOwner: accepted[0].user_id });
    } else {
      toDelete.push(sessionId);
    }
  });

  // 5. Transfer ownership for sessions with remaining members — Promise.allSettled
  if (transferable.length > 0) {
    await Promise.allSettled(
      transferable.map(({ sessionId, newOwner }) =>
        supabase
          .from("collaboration_sessions")
          .update({ created_by: newOwner })
          .eq("id", sessionId)
      )
    );
  }

  // 6. Delete under-populated sessions with IN clause — single query
  if (toDelete.length > 0) {
    await supabase
      .from("collaboration_sessions")
      .delete()
      .in("id", toDelete);
  }
}
```

### 5.5 Add `board_collaborators` Cleanup to `delete-user`

**File:** `supabase/functions/delete-user/index.ts`

In Batch 4 (the large parallel delete block, lines ~303-331), add a `board_collaborators` delete
alongside the other board-related deletes. Add it inside the `Promise.allSettled` array:

```typescript
// Add this line alongside board_saved_cards, board_user_swipe_states, etc.:
supabase.from("board_collaborators").delete().eq("user_id", userId),
```

---

## 6. Mobile Implementation

### Area A: Auth System

#### 6.A.1 Fix `useAuthSimple.ts` — Sign-Out Deduplication

**File:** `app-mobile/src/hooks/useAuthSimple.ts`

**Problem:** Multiple `useAuthSimple` instances each set up their own `onAuthStateChange`
listener. When a sign-out event fires, all instances handle it simultaneously, producing 3+
SIGNED_OUT events and race conditions on state clearing.

**Change:** Add a module-level flag (outside the hook, shared across all instances) that prevents
duplicate sign-out handling.

```typescript
// Add at the TOP of the file, before any imports or exports — module scope:
let _isHandlingSignOut = false;
```

Inside the `onAuthStateChange` handler, find the block that handles `SIGNED_OUT` events and wrap
it:

```typescript
// BEFORE (find the SIGNED_OUT handler inside onAuthStateChange):
if (event === "SIGNED_OUT") {
  clearUserData();
  // ... other sign-out logic
}

// AFTER:
if (event === "SIGNED_OUT") {
  if (_isHandlingSignOut) return;  // Already being handled by another instance
  _isHandlingSignOut = true;
  clearUserData();
  // ... other sign-out logic
  // Reset after a tick so re-login works
  setTimeout(() => { _isHandlingSignOut = false; }, 1000);
}
```

#### 6.A.2 Migrate 10 Components from `useAuthSimple` to `useAppStore`

The user is already written into Zustand (`appStore.user`) by `AppStateManager`. Every component
that calls `useAuthSimple()` just to get the `user` object should read from the store instead.

**Pattern:**

```typescript
// BEFORE (in each of the 10 components):
const { user } = useAuthSimple();

// AFTER:
const user = useAppStore((state) => state.user);
```

**Components to migrate** (grep for `useAuthSimple` to confirm the full list — these are the
confirmed callers that only need `user`):

Find every file that imports `useAuthSimple` and uses only `user` from it (not `signOut`,
`signInWithGoogle`, etc.). Those files should switch to `useAppStore`. Files that use auth
actions (`signOut`, `signInWithGoogle`, `signInWithApple`, `updateProfile`) must keep
`useAuthSimple` — those actions live there.

Do NOT migrate `AppStateManager.tsx` — it is the authoritative writer of `user` into Zustand and
must keep `useAuthSimple`.

Do NOT migrate `WelcomeScreen.tsx` or any screen that calls sign-in/sign-out methods.

#### 6.A.3 Fix Push Notification Routing in `app/index.tsx`

**File:** `app-mobile/app/index.tsx`

**Change:** Find the notification response handler where `friend_link_request` notification type
routes the user to `"connections"` (approximately lines 200-208). Change the navigation target to
`"discover"`.

```typescript
// BEFORE:
case "friend_link_request":
  setCurrentPage("connections");
  break;

// AFTER:
case "friend_link_request":
  setCurrentPage("discover");
  break;
```

Also find the foreground handler for `friend_link_request` (approximately lines 133-139). No
navigation change needed there — it already creates an in-app notification. Ensure the
`navigation.page` field in that in-app notification is set to `"discover"` so that tapping the
in-app banner also routes to Discover:

```typescript
// In the foreground handler for friend_link_request, ensure navigation.page is "discover":
inAppNotificationService.notifyFriendLinkRequest({
  ...existingParams,
  navigation: { page: "discover" },  // ← was "connections", change to "discover"
});
```

### Area B: Notification System

#### 6.B.1 Remove Email Guard in `messagingService.ts`

**File:** `app-mobile/src/services/messagingService.ts`

Find the notification sending function (likely `sendMessageNotifications` or similar). There is a
block that fetches the recipient's email profile and exits early if no email is found. Delete that
block entirely. The edge function (`send-message-email`) only needs `recipientId` — it handles
token lookup internally.

```typescript
// DELETE this block (find and remove — do NOT just comment it out):
const { data: recipientProfile } = await supabase
  .from("profiles")
  .select("email")
  .eq("id", recipientId)
  .single();

if (!recipientProfile?.email) return;  // ← This is the kill switch. Delete the whole block.
```

The call to the edge function that follows this block must be kept. Only the profile fetch and the
early return are removed.

#### 6.B.2 Remove Email Guard in `boardMessageService.ts`

**File:** `app-mobile/src/services/boardMessageService.ts`

Same pattern as 6.B.1. Find the block that fetches recipient email and returns early if absent
(approximately lines 738-792). Delete the fetch-and-guard block. Keep the edge function call.

#### 6.B.3 Replace `throw` with `console.warn` in `useFriends.ts`

**File:** `app-mobile/src/hooks/useFriends.ts`

Find the location inside `useFriends` where a notification error is re-thrown after the database
write has already succeeded (the friend request DB write completes, then the notification call
fails, and the error is thrown — which rolls back the UI even though the DB write succeeded).

```typescript
// BEFORE (find the throw inside the notification error handler):
} catch (notificationError) {
  throw notificationError;  // ← This is wrong — DB write already succeeded
}

// AFTER:
} catch (notificationError) {
  console.warn("[useFriends] Notification failed (non-critical):", notificationError);
  // Do NOT re-throw — notifications are side effects, not the primary operation
}
```

#### 6.B.4 Remove Duplicate Notification in `OnboardingFlow.tsx`

**File:** `app-mobile/src/components/OnboardingFlow.tsx` (or wherever onboarding sends friend
link notifications)

During onboarding, there is a block that calls BOTH `sendFriendLink()` AND the
`send-friend-request-email` edge function for the same user. `sendFriendLink` already sends the
push internally. The second call is a duplicate.

Find the block that calls `send-friend-request-email` directly (it will be an edge function call
or a fetch to that function name). Delete the entire block. Keep the `sendFriendLink()` call.

#### 6.B.5 Remove Ghost Fields

Ghost fields are parameters sent to edge functions that never read them — leftovers from the
email-auth era. Remove them from all call sites and TypeScript interfaces.

**Fields to remove everywhere:**
- `recipientEmail`
- `senderEmail`
- `recipientName`
- `receiverEmail`

**Do NOT remove** `sessionName` from `send-message-email` — it is unused today but is intentional
context for future notification copy.

**Files to audit** (grep for `recipientEmail`, `senderEmail`, `receiverEmail`, `recipientName`):
- `app-mobile/src/services/messagingService.ts`
- `app-mobile/src/services/boardMessageService.ts`
- `app-mobile/src/hooks/useFriends.ts`
- Any TypeScript interfaces in `app-mobile/src/types/` that declare these fields

For each occurrence: delete the field from the function call AND delete it from the TypeScript
interface if present.

### Area C: Infinite Loader

#### 6.C.1 Add Timeout to `enhancedLocationService.ts`

**File:** `app-mobile/src/services/enhancedLocationService.ts`

Find `getLastKnownLocation()`. It calls `Location.getLastKnownPositionAsync()`. This call has no
timeout and blocks indefinitely on some Android devices and simulators.

Wrap it in a `Promise.race` with a 3-second timeout:

```typescript
// BEFORE:
const position = await Location.getLastKnownPositionAsync();

// AFTER:
const timeoutPromise = new Promise<null>((resolve) =>
  setTimeout(() => resolve(null), 3000)
);
const position = await Promise.race([
  Location.getLastKnownPositionAsync(),
  timeoutPromise,
]);
```

If the timeout wins (position is `null`), the existing fallback logic (get current position) must
still execute. Ensure the `null` case is handled — it likely already is since
`getLastKnownPositionAsync` can return `null` legitimately.

#### 6.C.2 Add Timeout to `useUserPreferences.ts`

**File:** `app-mobile/src/hooks/useUserPreferences.ts`

The Supabase fetch (up to 30 seconds) with a fallback to `offlineService.getOfflineUserPreferences()`
(no timeout) creates a chain that can hang indefinitely.

Wrap the entire fetch chain in an 8-second total timeout:

```typescript
// Wrap the queryFn body:
const fetchWithTimeout = async () => {
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("useUserPreferences timed out after 8s")), 8000)
  );
  return Promise.race([existingFetchLogic(), timeoutPromise]);
};
```

If the timeout fires, `useUserPreferences` should return its `error` state. The
`RecommendationsContext` fix in 6.C.4 handles the downstream logic when preferences fail to load.

#### 6.C.3 Add Timeout to `useUserLocation.ts`

**File:** `app-mobile/src/hooks/useUserLocation.ts`

The location fetch has a 10-second GPS timeout but the total operation has no cap. Add a 13-second
total timeout (10s GPS + 3s buffer for last-known fallback):

```typescript
const fetchWithTimeout = async () => {
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new Error("useUserLocation timed out after 13s")),
      13000
    )
  );
  return Promise.race([existingLocationFetch(), timeoutPromise]);
};
```

When the timeout fires, the hook should set `locationError` to a truthy value so the
`RecommendationsContext` logic can proceed.

#### 6.C.4 Fix Logic Dead Zone in `RecommendationsContext.tsx`

**File:** `app-mobile/src/context/RecommendationsContext.tsx`

**Three changes required:**

**Change 1 — Add `allPrerequisitesSettled` branch:**

Find the "Mark Fetch Complete" `useEffect`. It currently has three branches that all require
either `userLocation !== null`, `recommendations.length > 0`, or `locationError` to be truthy.
When location resolves to `null` (no error, no data), none fire and the spinner runs forever.

Add a fourth branch:

```typescript
// ADD this branch to the "Mark Fetch Complete" effect, as the FINAL else-if:
else if (!isLoadingLocation && !isLoadingPreferences && !isLoadingRecommendations) {
  // All three loading flags are false — regardless of whether they returned data or null.
  // This is the settled state. Mark fetch complete.
  setIsFetchComplete(true);
}
```

**Change 2 — Add `effectivePrefs` fallback:**

Find the block that gates recommendation fetching on user preferences being loaded. When
preferences fail entirely, the deck never starts. Add a fallback:

```typescript
// BEFORE:
const effectivePrefs = userPreferences;
if (!effectivePrefs) return;  // Gates everything

// AFTER:
const effectivePrefs = userPreferences ?? {
  categories: ["Nature", "Casual Eats", "Drink"],  // sensible fallback deck
};
// Remove the early return — proceed with effectivePrefs
```

**Change 3 — Add 15-second mount-only nuclear timeout:**

Find where component-level `useRef` values are declared. Add:

```typescript
const hasStartedRef = useRef(false);

// In the main loading useEffect, add a mount-only 15s timeout:
useEffect(() => {
  if (hasStartedRef.current) return;  // Only run on first mount
  hasStartedRef.current = true;

  const safetyTimer = setTimeout(() => {
    setIsFetchComplete(true);
    console.warn("[RecommendationsContext] 15s safety timeout fired — forcing complete");
  }, 15000);

  return () => clearTimeout(safetyTimer);
}, []);  // Empty deps — mount only
```

Use `useRef` for the timer, not `useCallback`, to avoid stale closure capture of `setIsFetchComplete`.
Verify `setIsFetchComplete` is stable (it should be a `useState` setter — React guarantees stability).

### Area D: Board Collaboration System

#### 6.D.1 Fix `useSessionManagement.ts` — Populate `session_id` on Board Creation

**File:** `app-mobile/src/hooks/useSessionManagement.ts`

Inside the `acceptInvite` function, find the board creation call (approximately lines 854-873).
The call to create a new board does not pass `sessionId`. It must.

```typescript
// BEFORE (find the board creation inside acceptInvite):
const board = await boardService.createBoard(currentUserId, {
  name: sessionData.name,
  description: `Board for ${sessionData.name}`,
  collaborators: allAcceptedUserIds,
});

// AFTER — add sessionId:
const board = await boardService.createBoard(currentUserId, {
  name: sessionData.name,
  description: `Board for ${sessionData.name}`,
  collaborators: allAcceptedUserIds,
  sessionId: sessionData.id,   // ← This was missing
});
```

No changes required to `boardService.createBoard()` — it already accepts and stores `sessionId`
when provided.

#### 6.D.2 Verify Board Collaborators Insert in `useSessionManagement.ts`

After creating the migration in §4.1, the `board_collaborators` upsert (approximately lines
896-912) will succeed without changes. **Verify only** — no code change needed here assuming
the migration is applied first. The upsert already uses `onConflict: 'board_id,user_id'`
(idempotent) and assigns `role: 'owner'` for the session creator, `role: 'collaborator'` for all
others. This is correct as-is.

### Area E: Discover "For You" — Incoming Link Request Pills

This area implements the complete redesign of how incoming friend link requests are surfaced.
It covers 4 files: a new component, modifications to DiscoverScreen, ConnectionsPage cleanup,
and a new savedPeopleService method.

#### 6.E.1 New Component: `IncomingLinkRequestCard.tsx`

**File path:** `app-mobile/src/components/IncomingLinkRequestCard.tsx`
**Purpose:** The inline card that slides in below the pill row when the user taps an incoming
link request pill. Mirrors the animation pattern of PersonHolidayView.

```typescript
import React, { useEffect, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Animated,
  StyleSheet,
  ActivityIndicator,
} from "react-native";

export interface EnrichedLinkRequest {
  id: string;           // FriendLink.id
  requesterId: string;
  name: string;         // requester's display_name, falling back to first_name, then "Someone"
  avatarUrl: string | null;
  initials: string;     // First 2 characters of name, uppercased
}

interface Props {
  request: EnrichedLinkRequest;
  isAccepting: boolean;
  isDeclining: boolean;
  onAccept: (linkId: string) => void;
  onDecline: (linkId: string) => void;
}

export default function IncomingLinkRequestCard({
  request,
  isAccepting,
  isDeclining,
  onAccept,
  onDecline,
}: Props) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(30)).current;

  useEffect(() => {
    opacity.setValue(0);
    translateY.setValue(30);
    const timer = setTimeout(() => {
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 400,
          useNativeDriver: true,
        }),
        Animated.timing(translateY, {
          toValue: 0,
          duration: 400,
          useNativeDriver: true,
        }),
      ]).start();
    }, 200);
    return () => clearTimeout(timer);
  }, [request.id, opacity, translateY]);

  return (
    <Animated.View
      style={[styles.container, { opacity, transform: [{ translateY }] }]}
    >
      <View style={styles.avatarRow}>
        <View style={styles.avatar}>
          <Text style={styles.avatarInitials}>{request.initials}</Text>
        </View>
        <View style={styles.textBlock}>
          <Text style={styles.name}>{request.name}</Text>
          <Text style={styles.sub}>wants to link with you</Text>
        </View>
      </View>

      <Text style={styles.description}>
        When linked, your card activity helps personalise their recommendations — and vice versa.
      </Text>

      <View style={styles.buttonRow}>
        <TouchableOpacity
          style={[styles.acceptBtn, isAccepting && styles.btnDisabled]}
          onPress={() => onAccept(request.id)}
          disabled={isAccepting || isDeclining}
        >
          {isAccepting ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.acceptBtnText}>Accept</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.declineBtn, isDeclining && styles.btnDisabled]}
          onPress={() => onDecline(request.id)}
          disabled={isAccepting || isDeclining}
        >
          {isDeclining ? (
            <ActivityIndicator color="#9ca3af" size="small" />
          ) : (
            <Text style={styles.declineBtnText}>Decline</Text>
          )}
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 16,
    marginTop: 16,
    backgroundColor: "#1a1a1a",
    borderRadius: 16,
    padding: 20,
    borderLeftWidth: 4,
    borderLeftColor: "#eb7825",
  },
  avatarRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#2a2a2a",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  avatarInitials: {
    color: "#9ca3af",
    fontSize: 16,
    fontWeight: "600",
  },
  textBlock: {
    flex: 1,
  },
  name: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "700",
  },
  sub: {
    color: "#9ca3af",
    fontSize: 13,
    marginTop: 2,
  },
  description: {
    color: "#6b7280",
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 20,
  },
  buttonRow: {
    flexDirection: "row",
    gap: 12,
  },
  acceptBtn: {
    flex: 1,
    backgroundColor: "#eb7825",
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
  },
  acceptBtnText: {
    color: "#ffffff",
    fontWeight: "700",
    fontSize: 14,
  },
  declineBtn: {
    flex: 1,
    backgroundColor: "#2a2a2a",
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
  },
  declineBtnText: {
    color: "#9ca3af",
    fontWeight: "600",
    fontSize: 14,
  },
  btnDisabled: {
    opacity: 0.5,
  },
});
```

#### 6.E.2 Add Method to `savedPeopleService.ts`: `upsertSavedPersonByLink`

**File:** `app-mobile/src/services/savedPeopleService.ts`

After accepting a link request, we need to ensure the requester exists as a `SavedPerson` for the
current user so `PersonHolidayView` has a person object to render.

Add this function to the service:

```typescript
/**
 * Creates or updates a SavedPerson record for a linked user.
 * Called after accepting a friend link request so PersonHolidayView can render immediately.
 * Uses upsert on (user_id, linked_user_id) to be idempotent.
 */
export async function upsertSavedPersonByLink(params: {
  currentUserId: string;
  linkedUserId: string;
  linkId: string;
  name: string;         // requester's display_name or first_name
  initials: string;
}): Promise<SavedPerson | null> {
  const { data, error } = await supabase
    .from("saved_people")
    .upsert(
      {
        user_id: params.currentUserId,
        name: params.name,
        initials: params.initials,
        linked_user_id: params.linkedUserId,
        link_id: params.linkId,
        is_linked: true,
      },
      { onConflict: "user_id,linked_user_id" }
    )
    .select()
    .single();

  if (error) {
    console.warn("[savedPeopleService] upsertSavedPersonByLink failed:", error);
    return null;
  }
  return data as SavedPerson;
}
```

#### 6.E.3 Modify `DiscoverScreen.tsx` — Comprehensive Changes

**File:** `app-mobile/src/components/DiscoverScreen.tsx`

This file requires 7 discrete changes. Apply them in the order listed.

---

**Change E.3.1 — Add import for new component and service method**

At the top of the file, add:

```typescript
import IncomingLinkRequestCard, { EnrichedLinkRequest } from "./IncomingLinkRequestCard";
import { upsertSavedPersonByLink } from "../services/savedPeopleService";
```

Also add `useQueryClient` to the React Query import if not already present:

```typescript
import { useQueryClient } from "@tanstack/react-query";
```

---

**Change E.3.2 — Add new state variable**

Find the block of `useState` declarations near the top of the component. Add:

```typescript
const [selectedIncomingRequestId, setSelectedIncomingRequestId] = useState<string | null>(null);
const [enrichedLinkRequests, setEnrichedLinkRequests] = useState<EnrichedLinkRequest[]>([]);
const queryClient = useQueryClient();
```

---

**Change E.3.3 — Add effect to enrich incoming link requests with profile data**

After the `pendingLinkRequests` data is available (after line ~919), add a `useEffect` that
batch-fetches requester profiles:

```typescript
useEffect(() => {
  if (!pendingLinkRequests || pendingLinkRequests.length === 0) {
    setEnrichedLinkRequests([]);
    return;
  }

  const requesterIds = pendingLinkRequests.map((r: any) => r.requesterId);

  supabase
    .from("profiles")
    .select("id, display_name, first_name, avatar_url")
    .in("id", requesterIds)
    .then(({ data }) => {
      if (!data) return;
      const profileMap = new Map(data.map((p) => [p.id, p]));
      const enriched: EnrichedLinkRequest[] = pendingLinkRequests.map((req: any) => {
        const profile = profileMap.get(req.requesterId);
        const name =
          profile?.display_name ||
          profile?.first_name ||
          "Someone";
        return {
          id: req.id,
          requesterId: req.requesterId,
          name,
          avatarUrl: profile?.avatar_url ?? null,
          initials: name.slice(0, 2).toUpperCase(),
        };
      });
      setEnrichedLinkRequests(enriched);
    });
}, [pendingLinkRequests]);
```

---

**Change E.3.4 — Add accept/decline handlers for incoming request pills**

Find the existing `handlePersonSelect` function. After it, add:

```typescript
const handleIncomingRequestSelect = (requestId: string) => {
  HapticFeedback.buttonPress();
  setSelectedPersonId("for-you");  // Deselect any person pill
  setSelectedIncomingRequestId(requestId);
};

const handleAcceptLinkRequest = async (linkId: string) => {
  const request = enrichedLinkRequests.find((r) => r.id === linkId);
  if (!request) return;

  try {
    await respondToLinkMutation.mutateAsync({ linkId, action: "accept" });

    // Upsert the requester as a SavedPerson so PersonHolidayView can render
    const newPerson = await upsertSavedPersonByLink({
      currentUserId: user?.id ?? "",
      linkedUserId: request.requesterId,
      linkId,
      name: request.name,
      initials: request.initials,
    });

    // Invalidate savedPeople cache so pill row refreshes
    queryClient.invalidateQueries({ queryKey: ["saved-people", user?.id] });

    setSelectedIncomingRequestId(null);

    // Immediately open PersonHolidayView for the newly linked person
    if (newPerson) {
      setSelectedPersonId(newPerson.id);
    }
  } catch (err) {
    Alert.alert("Error", "Failed to accept. Please try again.");
  }
};

const handleDeclineLinkRequest = (linkId: string) => {
  if (respondToLinkMutation.isPending) return;
  respondToLinkMutation.mutate(
    { linkId, action: "decline" },
    {
      onSuccess: () => {
        setSelectedIncomingRequestId(null);
        setEnrichedLinkRequests((prev) => prev.filter((r) => r.id !== linkId));
      },
      onError: () => Alert.alert("Error", "Failed to decline. Please try again."),
    }
  );
};
```

---

**Change E.3.5 — Add incoming request pills to the pill row**

Find the horizontal `ScrollView` that renders saved people pills (approximately lines 3201-3282).
After the last saved person pill is rendered (just before the closing `</ScrollView>`), add the
incoming request pills:

```typescript
{/* Incoming link request pills — grey, same opacity as outbound pending */}
{enrichedLinkRequests.map((request) => (
  <TouchableOpacity
    key={`incoming-${request.id}`}
    onPress={() => handleIncomingRequestSelect(request.id)}
    style={[
      styles.personPill,
      selectedIncomingRequestId === request.id && styles.personPillSelected,
      { opacity: 0.5 },
    ]}
  >
    <View style={[styles.personPillAvatar, { backgroundColor: "#d1d5db" }]}>
      <Text style={styles.personPillInitials}>{request.initials}</Text>
    </View>
    <Text style={styles.personPillName} numberOfLines={1}>
      {request.name}
    </Text>
  </TouchableOpacity>
))}
```

---

**Change E.3.6 — Add IncomingLinkRequestCard to content area**

Find the content conditional block (approximately lines 3286-3402) which reads:

```typescript
{selectedPerson ? (
  <PersonHolidayView ... />
) : (
  // hero + grid
)}
```

Add a new branch for incoming request selection BEFORE the `selectedPerson` check:

```typescript
{selectedIncomingRequestId ? (
  <IncomingLinkRequestCard
    request={enrichedLinkRequests.find((r) => r.id === selectedIncomingRequestId)!}
    isAccepting={respondToLinkMutation.isPending && /* accepting this specific one */ true}
    isDeclining={respondToLinkMutation.isPending && /* declining this specific one */ true}
    onAccept={handleAcceptLinkRequest}
    onDecline={handleDeclineLinkRequest}
  />
) : selectedPerson ? (
  <PersonHolidayView
    person={selectedPerson}
    location={...}
    userId={user?.id ?? ""}
  />
) : (
  // hero + grid — unchanged
)}
```

**Note on isAccepting/isDeclining:** For simplicity, if only one request can be acted on at a
time (which the `disabled` state on buttons ensures), passing `respondToLinkMutation.isPending`
for both is acceptable. The buttons are disabled while any mutation is in flight.

---

**Change E.3.7 — Remove `LinkRequestBanner`**

Find the `LinkRequestBanner` block (approximately lines 3152-3170):

```typescript
{pendingLinkRequests.length > 0 && (
  <LinkRequestBanner
    requests={pendingLinkRequests}
    onAccept={...}
    onDecline={...}
  />
)}
```

Delete this block entirely. The incoming request pills (Change E.3.5) and the
`IncomingLinkRequestCard` (Change E.3.6) replace it completely.

Also remove the `import LinkRequestBanner from "./LinkRequestBanner"` at the top of the file.

---

#### 6.E.4 Modify `ConnectionsPage.tsx` — Remove Link Requests from RequestsView

**File:** `app-mobile/src/components/ConnectionsPage.tsx`

Currently (approximately lines 256-295), the connections page merges incoming link requests
(`_source: "link"`) with legacy friend requests (`_source: "legacy"`) into a single
`incomingRequests` array that is passed to `RequestsView`.

**Change:** Filter out link requests from this merged array. Only legacy friend requests belong
in the connections page. Link requests now live exclusively on Discover.

```typescript
// BEFORE (find the merge block):
const incomingRequests = [
  ...linkRequests.map((r) => ({ ...r, _source: "link" })),
  ...legacyFriendRequests.map((r) => ({ ...r, _source: "legacy" })),
];

// AFTER — remove the link requests line:
const incomingRequests = [
  ...legacyFriendRequests.map((r) => ({ ...r, _source: "legacy" })),
];
```

Also remove the imports for `usePendingLinkRequests`, `useSentLinkRequests`, and
`useRespondToFriendLink` from `ConnectionsPage.tsx` if they are no longer used elsewhere in that
file after this change. Check the full file before removing imports.

---

## 7. Implementation Order

Execute every step in this exact sequence. Do not reorder. Each step is a prerequisite for the next.

**Step 1 — Run migration 1: Create `board_collaborators`**

Copy the SQL from §4.1 into a new file at:
`supabase/migrations/20260312000001_create_board_collaborators.sql`

Apply it via `supabase db push` or the Supabase SQL editor.

Verify: Run `SELECT * FROM public.board_collaborators LIMIT 1` — returns zero rows with the
correct column structure. Run as unauthenticated user — returns permission denied. Run as an
authenticated user who is NOT a session participant — returns zero rows.

**Step 2 — Run migration 2: Create `notification_preferences`**

Copy the SQL from §4.2 into:
`supabase/migrations/20260312000002_create_notification_preferences.sql`

Apply it. Verify: `SELECT * FROM public.notification_preferences LIMIT 1` returns zero rows.

**Step 3 — Create `supabase/functions/_shared/push-utils.ts`**

Create the file from §5.1 exactly. No deployment needed yet — it is a shared utility imported
by the functions being updated in Step 4.

**Step 4 — Update all 8 push-sending edge functions**

Update each of the 8 functions listed in §5.2. Replace their direct Expo `fetch` calls with
`sendPush()`. Deploy each updated function with `supabase functions deploy [function-name]`.

Verify for each: trigger a push notification to a valid token — delivery succeeds. Manually set
a token value in `user_push_tokens` to a fake/expired token — trigger a notification — the fake
token is deleted from the table after the edge function runs.

**Step 5 — Fix `delete-user` edge function**

Apply both changes from §5.3 (flip deletion order) and §5.4 (fix N+1). Also add the
`board_collaborators` delete from §5.5.

Deploy: `supabase functions deploy delete-user`

Verify: Create a test user in a staging environment. Put them in 3 collaboration sessions. Delete
the account. Confirm completion in under 10 seconds. Confirm auth.users row is gone before
profiles row is gone (check timestamps if necessary).

**Step 6 — Fix auth sign-out deduplication (`useAuthSimple.ts`)**

Apply change from §6.A.1. Run the app. Perform a sign-out. Confirm only ONE `[AUTH] Auth state
change: SIGNED_OUT` appears in the log.

**Step 7 — Migrate components from `useAuthSimple` to `useAppStore`**

Apply all migrations from §6.A.2. Run the app. Navigate to all 5 tabs. Confirm `[AUTH]
Initializing — fetching session...` appears at most twice in the entire session (once on startup,
once on cold navigation to a new tab that has never initialized).

**Step 8 — Fix notification routing in `app/index.tsx`**

Apply change from §6.A.3. Test: send a `friend_link_request` push notification. Tap it. Confirm
the app opens on the Discover tab with "For You" active.

**Step 9 — Apply all notification system fixes**

Apply §6.B.1 through §6.B.5 in order. Test: send a message from a phone-only user (no email in
profile). Confirm the recipient receives a push notification.

**Step 10 — Apply infinite loader fixes**

Apply §6.C.1 through §6.C.4 in order. Test: disable GPS on a test device, open the app. Confirm
the spinner resolves within 15 seconds with a fallback experience deck shown.

**Step 11 — Fix board collaboration (`useSessionManagement.ts`)**

Apply §6.D.1. Test: complete a full collaboration session flow (create session, invite user,
accept invite). Confirm no `board_collaborators` error in logs. Confirm both users see the session
as active. Confirm the pill on the inviter's home screen turns active.

**Step 12 — Create `IncomingLinkRequestCard.tsx`**

Create the file from §6.E.1 exactly.

**Step 13 — Add `upsertSavedPersonByLink` to `savedPeopleService.ts`**

Apply §6.E.2.

**Step 14 — Modify `DiscoverScreen.tsx`**

Apply all 7 changes from §6.E.3 in order (E.3.1 → E.3.7). Run the app. Confirm:
- Incoming link requests appear as grey pills
- Tapping shows the IncomingLinkRequestCard with animation
- No `LinkRequestBanner` visible anywhere on Discover

**Step 15 — Modify `ConnectionsPage.tsx`**

Apply §6.E.4. Confirm link requests no longer appear in the connections tab requests view.

**Step 16 — Full end-to-end test**

Walk through every success criterion in §3. Every criterion must pass before marking this spec
as implemented.

---

## 8. Test Cases

| # | Test | Input | Expected Output | Layer |
|---|------|-------|-----------------|-------|
| 1 | board_collaborators table exists | SELECT * FROM board_collaborators | Zero rows, no error | DB |
| 2 | Unauthenticated access to board_collaborators | SELECT as anon | Zero rows / permission denied | DB/RLS |
| 3 | Accept collaboration invite | User B accepts invite from User A | board_collaborators row created for both users; no PGRST205 error | DB + Mobile |
| 4 | Inviter sees active pill after acceptance | User A after User B accepts | Collaboration pill on A's home turns active within 5s | Mobile/Realtime |
| 5 | Phone-only user receives push | User with no email; another user sends message | Push notification delivered | Edge + DB |
| 6 | DeviceNotRegistered token purged | Send push to expired Expo token | Token deleted from user_push_tokens | Edge |
| 7 | Account deletion completes in time | User in 5 sessions; trigger delete-user | Completes in < 15 seconds; no 45s timeout | Edge |
| 8 | Auth deletes before profile | Trigger account deletion | auth.users row deleted before public.profiles row | Edge |
| 9 | Single sign-out event | Sign out from app | Exactly 1 SIGNED_OUT log event | Mobile |
| 10 | Single auth init per session | Launch app, navigate 5 tabs | "Initializing — fetching session" appears ≤ 2 times | Mobile |
| 11 | Incoming request pill appears | User has a pending incoming link request | Grey pill visible in Discover "For You" pill row | Mobile |
| 12 | Tapping incoming pill shows card | Tap incoming request grey pill | IncomingLinkRequestCard animates in below pills | Mobile |
| 13 | Accept from pill opens PersonHolidayView | Tap Accept on IncomingLinkRequestCard | PersonHolidayView opens for that person immediately | Mobile |
| 14 | Decline removes pill | Tap Decline on IncomingLinkRequestCard | Card dismisses; grey pill removed from row | Mobile |
| 15 | Push notification routes to Discover | friend_link_request push received; user taps it | App opens on Discover tab, "For You" selected | Mobile |
| 16 | No link requests in Connections tab | User has pending link requests | Connections tab shows only legacy friend requests | Mobile |
| 17 | No LinkRequestBanner on Discover | User has pending link requests | Only grey pills shown; no banner visible | Mobile |
| 18 | Infinite loader resolves with no location | GPS disabled on device | Spinner stops within 15 seconds; deck loads with fallback prefs | Mobile |
| 19 | Person pill name after accept | Accept a link request from a phone-invited user | Pill shows display_name (e.g., "John"), not "+14155551234" | Mobile |
| 20 | Duplicate onboarding notification removed | New user completes onboarding with friend link | Friend receives exactly 1 notification, not 2 | Mobile + Edge |

---

## 9. Common Mistakes to Avoid

1. **Running migrations out of order:** `board_collaborators` (migration 1) must exist before Step
   11 (mobile collaboration fix). If you run the mobile fix first, the upsert will still fail with
   PGRST205. Do Steps 1-2 before any mobile work.

2. **Migrating `AppStateManager.tsx` away from `useAuthSimple`:** AppStateManager is the writer
   of `user` into Zustand. If you migrate it, nothing writes to the store and every other
   component that reads `useAppStore.user` will get null. Only migrate components that READ user,
   not the one that WRITES it.

3. **Removing the `_isHandlingSignOut` reset:** If you forget the `setTimeout(() => { _isHandlingSignOut = false; }, 1000)` reset in Step 6, the user cannot sign back in during the same
   session — every subsequent SIGNED_IN event will be blocked by the stale flag. The reset is
   mandatory.

4. **Using `respondToLinkMutation` for both accept and decline tracking:** The single mutation
   reference can't distinguish which action is in flight. If you need precise loading states per
   button (accept spinner vs decline spinner), add a local `[pendingAction, setPendingAction]`
   state that tracks `"accept" | "decline" | null` and gates the spinners on that.

5. **Not invalidating the `saved-people` query key after accepting:** If you call
   `upsertSavedPersonByLink` but don't invalidate the query, the pill row will not refresh and the
   new person won't appear with the orange (linked) style. The invalidation in `handleAcceptLinkRequest`
   (Change E.3.4) must use the exact same query key as `useSavedPeople` — verify the key format
   matches before shipping.

---

## 10. Handoff to Implementor

Implementor: execute top to bottom, Step 1 through Step 16, without skipping or reordering. The
migrations in Steps 1-2 are prerequisites for everything else — they must be applied and verified
before any mobile code changes. Every file path, function signature, SQL statement, and validation
rule in this document is intentional and exact. If something appears wrong or unclear, stop and
ask before improvising. When finished, produce `IMPLEMENTATION_REPORT.md` referencing each section
of this spec to confirm compliance, then hand to the tester.

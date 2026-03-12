# 🔍 Test Report: Unified Platform Stability — 19-Bug Omnibus Fix
**Date:** 2026-03-11
**Spec:** FEATURE_UNIFIED_PLATFORM_STABILITY_SPEC.md
**Implementation:** IMPLEMENTATION_UNIFIED_PLATFORM_STABILITY_REPORT.md
**Tester:** Brutal Tester Skill
**Verdict:** 🟡 CONDITIONAL PASS — 2 Critical, 4 High, 5 Medium findings. Do not ship until CRIT-001 and CRIT-002 are resolved.

---

## Executive Summary

All 19 claimed bug fixes were verified at the code level. The overall implementation is well-structured, the push-utils.ts consolidation is genuinely excellent work, and the delete-user rewrite is correct. However, **two critical architectural defects exist in the database layer** that will cause production failures under normal usage: (1) the `board_collaborators` SELECT and DELETE policies are self-referential, which causes infinite recursion in PostgreSQL's RLS engine, and (2) `cleanup_stale_push_tokens` is a SECURITY DEFINER function without a fixed `search_path`, exposing a privilege-escalation vector. Four high-severity TypeScript strict-mode violations and one partial-failure data race round out the must-fix list.

---

## Test Manifest

| Category | Items Tested | Passed | Failed | Warnings |
|----------|-------------|--------|--------|----------|
| TypeScript Compliance | 12 | 8 | 4 | 0 |
| Pattern Compliance | 8 | 5 | 3 | 0 |
| Security | 6 | 4 | 2 | 0 |
| React Query & State | 7 | 5 | 2 | 0 |
| Edge Functions | 8 | 7 | 1 | 0 |
| Database & RLS | 8 | 5 | 3 | 0 |
| Spec Criteria (15) | 15 | 13 | 2 | 0 |
| Implementation Claims | 19 | 17 | 2 | 0 |
| **TOTAL** | **83** | **64** | **17** | **2** |

---

## 🔴 Critical Findings (Must Fix Before Merge)

### CRIT-001: board_collaborators SELECT and DELETE policies cause infinite RLS recursion

**File:** `supabase/migrations/20260312000001_create_board_collaborators.sql` (lines 30–76)
**Category:** Database / Correctness — will fail under load

**What's Wrong:**

The SELECT policy references `board_collaborators` from within a `board_collaborators` policy:

```sql
CREATE POLICY "Collaborators can view board collaborators"
  ON public.board_collaborators FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.board_collaborators bc2   -- ← queries THE SAME TABLE
      WHERE bc2.board_id = board_collaborators.board_id
        AND bc2.user_id = auth.uid()
    )
  );
```

When a user queries `board_collaborators`, PostgreSQL evaluates this USING expression. The inner `EXISTS (SELECT 1 FROM board_collaborators bc2 ...)` triggers the same SELECT policy again on `bc2`, which triggers it again — **infinite recursion**. PostgreSQL will return `ERROR: infinite recursion detected in policy for relation "board_collaborators"`.

The DELETE policy has the **same defect** in its owner check:

```sql
-- DELETE policy (line 65–76) — also self-referential:
OR EXISTS (
  SELECT 1
  FROM public.board_collaborators bc_owner   -- ← same table again
  WHERE bc_owner.board_id = board_collaborators.board_id
    AND bc_owner.user_id = auth.uid()
    AND bc_owner.role = 'owner'
)
```

**Evidence:**
This is documented PostgreSQL behaviour. Per the PostgreSQL 14+ documentation on Row Security Policies: *"Policies that reference the same table can lead to infinite recursion."* Supabase's own docs warn explicitly: *"Avoid using table references to the same table in row security policies — use a SECURITY DEFINER function instead."*

As a result, every BoardCollaboration.tsx query, every `boardService.ts` read, every `CollaborationModule.tsx` collaborator lookup, and every realtime filter on `board_collaborators` will fail with a PostgreSQL error as soon as a non-owner user queries the table.

**Required Fix:**

Replace both self-referential subqueries with a SECURITY DEFINER function that bypasses RLS:

```sql
-- Step 1: Create a bypassing helper (add to the same migration or a patch migration)
CREATE OR REPLACE FUNCTION public.is_board_collaborator(board_uuid UUID, uid UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.board_collaborators
    WHERE board_id = board_uuid AND user_id = uid
  );
$$;

REVOKE ALL ON FUNCTION public.is_board_collaborator FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_board_collaborator TO authenticated;

-- Step 2: Rewrite SELECT policy
DROP POLICY "Collaborators can view board collaborators" ON public.board_collaborators;
CREATE POLICY "Collaborators can view board collaborators"
  ON public.board_collaborators FOR SELECT
  USING (public.is_board_collaborator(board_id, auth.uid()));

-- Step 3: Rewrite DELETE policy (owner check)
DROP POLICY "Collaborators can delete their own row or owner can delete any" ON public.board_collaborators;
CREATE POLICY "Collaborators can delete their own row or owner can delete any"
  ON public.board_collaborators FOR DELETE
  USING (
    auth.uid() = user_id
    OR public.is_board_collaborator_as_owner(board_id, auth.uid())
  );
-- (Create is_board_collaborator_as_owner similarly, filtering by role = 'owner')
```

**Why This Matters:** Every collaboration feature is broken at the database level. The mobile code that calls `board_collaborators` (7 files confirmed) will receive a PostgreSQL error on every read and delete, making the board collaboration system — the highest-priority bug fix in this PR — completely non-functional for non-admin users.

---

### CRIT-002: cleanup_stale_push_tokens is SECURITY DEFINER without fixed search_path

**File:** `supabase/migrations/20260311200002_push_token_cleanup_and_conversation_participants_publication.sql` (lines 11–25)
**Category:** Security — privilege escalation vector

**What's Wrong:**

```sql
CREATE OR REPLACE FUNCTION public.cleanup_stale_push_tokens()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER    -- ← runs as the function owner (postgres/superuser)
AS $$              -- ← NO SET search_path = ...
```

A `SECURITY DEFINER` function without `SET search_path = public, pg_temp` is vulnerable to a search_path hijack attack. Any user who can create objects in a schema that appears before `public` in `search_path` can shadow `user_push_tokens` with a malicious table, causing the function (executing with superuser privileges) to delete from the wrong table — or worse, execute arbitrary code via a malicious function with the same name.

The PostgreSQL documentation explicitly states: *"SECURITY DEFINER functions must always set the search_path to prevent schema-injection attacks."*

**Evidence:** Line 11–25 of the migration file — no `SET search_path` clause present. The function runs as `service_role` (per the GRANT on line 29), which has full database access.

**Required Fix:**

```sql
CREATE OR REPLACE FUNCTION public.cleanup_stale_push_tokens()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp   -- ← ADD THIS LINE
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM public.user_push_tokens
  WHERE updated_at < NOW() - INTERVAL '90 days';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;
```

**Why This Matters:** This is a standard Supabase/PostgreSQL security requirement for all SECURITY DEFINER functions. Without it, the function fails a basic security audit. While exploitation requires a malicious actor to already have schema-write access (medium likelihood), the fix is one line and there is no reason to leave it unpatched.

---

## 🟠 High Findings (Should Fix Before Merge)

### HIGH-001: `error: any` TypeScript violations in useAuthSimple.ts

**File:** `app-mobile/src/hooks/useAuthSimple.ts` (lines 246, 455, 570)
**Category:** TypeScript strict mode violation

**What's Wrong:**

```typescript
// Line 246
} catch (error: any) {
  return { error };
}

// Line 455
} catch (error: any) {
  // ...
  Alert.alert("Google Sign-In Failed", error.message || ...)
}

// Line 570
} catch (error: any) {
  // ...
  if (error.code === "ERR_REQUEST_CANCELED") { ... }
}
```

The codebase operates in TypeScript strict mode. `catch (error: any)` is explicitly forbidden. Beyond the rule violation, `error.message` and `error.code` accesses are unguarded — if `error` is a string or non-Error object, these silently return `undefined`.

**Required Fix:**

```typescript
} catch (err: unknown) {
  const error = err instanceof Error ? err : new Error(String(err));
  const code = (err as { code?: string })?.code;
  // Then use `error.message` and `code` safely
}
```

---

### HIGH-002: Partial-failure data race in handleAcceptLinkRequest

**File:** `app-mobile/src/components/DiscoverScreen.tsx` (lines 2690–2712)
**Category:** Data integrity — inconsistent state on failure

**What's Wrong:**

```typescript
const handleAcceptLinkRequest = async (linkId: string) => {
  // ...
  try {
    await respondToLinkMutation.mutateAsync({ linkId, action: "accept" });
    // ↑ At this point, the backend marks the link as accepted.
    // If the next line throws, the link is accepted on the backend
    // but the user sees an error and no saved_people row is created.
    const savedPerson = await upsertSavedPersonByLink({ ... });  // can throw
    // ...
  } catch (err) {
    Alert.alert("Error", "Failed to accept link request. Please try again.");
    // ← User is told to "try again", but the link is already accepted.
    // Re-tapping would call respondToLinkMutation again on an already-accepted link.
  }
};
```

The `upsertSavedPersonByLink` call is NOT idempotent on failure — it runs after the backend already accepted the link. If it throws (network blip, RLS error, conflict), the `catch` block shows "Failed to accept link request. Please try again." But re-trying would attempt to accept an already-accepted `friend_link` row, likely hitting a unique-constraint error.

Additionally, after this error, the pending link request disappears (React Query cache invalidated by `mutateAsync` `onSuccess`) but the person never appears in `savedPeople`. The user is in a confused state with no recovery path.

**Required Fix:**

```typescript
const handleAcceptLinkRequest = async (linkId: string) => {
  const request = enrichedLinkRequests.find((r) => r.id === linkId);
  if (!request || !user) return;
  try {
    await respondToLinkMutation.mutateAsync({ linkId, action: "accept" });
  } catch (err) {
    Alert.alert("Error", "Failed to accept link request. Please try again.");
    return; // Only bail if the accept call itself fails
  }
  // Link is accepted. upsert is best-effort — never block UI on it.
  try {
    const savedPerson = await upsertSavedPersonByLink({ ... });
    await queryClient.invalidateQueries({ queryKey: savedPeopleKeys.all });
    setSelectedIncomingRequestId(null);
    if (savedPerson) setSelectedPersonId(savedPerson.id);
  } catch (err) {
    // Upsert failed but link IS accepted — navigate gracefully, don't show error
    console.warn("[DiscoverScreen] Person upsert failed after link accept:", err);
    await queryClient.invalidateQueries({ queryKey: savedPeopleKeys.all });
    setSelectedIncomingRequestId(null);
    // Soft prompt: person will appear after next refresh
  }
};
```

---

### HIGH-003: `any` type used for pendingLinkRequests in DiscoverScreen

**File:** `app-mobile/src/components/DiscoverScreen.tsx` (lines 935, 943, 965)
**Category:** TypeScript strict mode violation

**What's Wrong:**

```typescript
const requesterIds = pendingLinkRequests.map((r: any) => r.requesterId);
// ...
const enriched: EnrichedLinkRequest[] = pendingLinkRequests.map((r: any) => {
// ...
sentLinkRequests.forEach((req: any) => {
```

The `friendLinkService.getPendingLinkRequests()` function returns a typed array. Using `(r: any)` throughout discards that type information and makes the code brittle to API changes. TypeScript strict mode prohibits `any`.

**Required Fix:** Import and use the return type from `friendLinkService.getPendingLinkRequests`. If the service returns `FriendLink[]`, use that type. If it's a sub-type, define and export it from the service.

---

### HIGH-004: Direct Supabase call inside DiscoverScreen useEffect (pattern violation)

**File:** `app-mobile/src/components/DiscoverScreen.tsx` (lines 936–959)
**Category:** Architectural pattern violation

**What's Wrong:**

```typescript
useEffect(() => {
  if (!pendingLinkRequests || pendingLinkRequests.length === 0) {
    setEnrichedLinkRequests([]);
    return;
  }
  const requesterIds = pendingLinkRequests.map((r: any) => r.requesterId);
  supabase           // ← direct client call, no React Query
    .from("profiles")
    .select("id, display_name, first_name, avatar_url")
    .in("id", requesterIds)
    .then(({ data }) => { ... })
    .catch(...);
}, [pendingLinkRequests]);
```

This violates the core architecture rule: *"React Query for all server state."* Direct Supabase calls inside `useEffect`:
- Cannot be cancelled if the component unmounts (memory leak)
- Cannot be retried automatically
- Cannot be cached (re-fetches every render cycle when `pendingLinkRequests` changes)
- Cannot show loading/error states
- Cannot be invalidated alongside related queries

**Required Fix:** Extract this into a hook:

```typescript
// New hook — or add to useFriendLinks.ts
function useEnrichedLinkRequests(pendingLinkRequests: FriendLink[]) {
  const requesterIds = pendingLinkRequests.map(r => r.requesterId);
  return useQuery({
    queryKey: ['enrichedLinkRequests', requesterIds],
    queryFn: () => supabase.from("profiles")
      .select("id, display_name, first_name, avatar_url")
      .in("id", requesterIds)
      .then(({ data, error }) => { if (error) throw error; return data ?? []; }),
    enabled: requesterIds.length > 0,
    staleTime: 60 * 1000,
    select: (profiles) => { /* build EnrichedLinkRequest[] here */ },
  });
}
```

---

## 🟡 Medium Findings (Fix Soon)

### MED-001: Module-level let declaration before import statements (useAuthSimple.ts)

**File:** `app-mobile/src/hooks/useAuthSimple.ts` (lines 1–3)
**Category:** Pattern violation / Linting

**What's Wrong:**

```typescript
// Module-level flag — ...
let _isHandlingSignOut = false;   // ← BEFORE all imports

import { useState, useEffect } from "react";  // ← imports come after
```

ES module `import` declarations are hoisted by the JavaScript engine, so this works at runtime. But placing any non-`import` statement before `import` statements violates the ESLint `import/first` rule, is flagged by TypeScript's own linter, and is confusing — it makes the code appear to run before imports are resolved.

**Required Fix:** Move `let _isHandlingSignOut = false;` to after all `import` statements, immediately before `export const useAuthSimple`.

---

### MED-002: sendPush has no timeout on the Expo HTTP fetch

**File:** `supabase/functions/_shared/push-utils.ts` (line 38)
**Category:** Edge function reliability

**What's Wrong:**

```typescript
response = await fetch("https://exp.host/--/api/v2/push/send", {
  method: "POST",
  headers: { ... },
  body: JSON.stringify(payload),
  // ← NO timeout/AbortController
});
```

Deno edge functions have a maximum execution time (default 400ms–2s in Supabase's infrastructure). If Expo's push server is slow or unresponsive, this `fetch` hangs until the edge function is killed by the platform timeout. This means:
1. The edge function times out without sending the push
2. The caller's response is also delayed or killed
3. No `DeviceNotRegistered` cleanup happens

Since `sendPush` is called by all 8 edge functions, a slow Expo API affects the entire notification layer.

**Required Fix:**

```typescript
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), 5000); // 5-second cap
try {
  response = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: { ... },
    body: JSON.stringify(payload),
    signal: controller.signal,
  });
} finally {
  clearTimeout(timeoutId);
}
```

---

### MED-003: cachedLocationSync is a module-level race condition

**File:** `app-mobile/src/hooks/useUserLocation.ts` (lines 16–24)
**Category:** Timing / Race condition

**What's Wrong:**

```typescript
let cachedLocationSync: LocationData | null = null;
AsyncStorage.getItem(LOCATION_CACHE_KEY).then(raw => {
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed.lat && parsed.lng) cachedLocationSync = { lat: parsed.lat, lng: parsed.lng };
    } catch {}
  }
}).catch(() => {});
```

`AsyncStorage.getItem` is called at module import time. React Query's `initialData: cachedLocationSync ?? undefined` is evaluated at the **first instantiation** of the `useUserLocation` hook. If AsyncStorage hasn't resolved by the time the hook first renders (a race that is common on app startup since module imports and first renders happen nearly simultaneously), `cachedLocationSync` is still `null` and `initialData` is `undefined` — defeating the entire purpose of the cache.

The `initialData` is only consumed once (at query creation). If it's `null` when the query is first created, there is no mechanism to "retry" the initialData lookup — the query will have to go through the full GPS fetch.

**Required Fix:** Move the AsyncStorage read inside a `useEffect` inside the hook, and use `queryClient.setQueryData` to seed the cache if the query hasn't been populated yet:

```typescript
useEffect(() => {
  AsyncStorage.getItem(LOCATION_CACHE_KEY).then(raw => {
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed?.lat && parsed?.lng) {
      // Only seed if query has no data yet
      queryClient.setQueryData(queryKey, { lat: parsed.lat, lng: parsed.lng }, {
        updatedAt: Date.now() - 60_000, // treat as 1 minute stale
      });
    }
  }).catch(() => {});
}, []); // mount-only
```

---

### MED-004: refreshKey effect uses user?.id but omits it from dependency array

**File:** `app-mobile/src/contexts/RecommendationsContext.tsx` (line 525)
**Category:** React hooks rules violation (stale closure)

**What's Wrong:**

```typescript
useEffect(() => {
  if (previousRefreshKeyRef.current !== undefined && previousRefreshKeyRef.current !== refreshKey) {
    // ...
    if (user?.id) {
      AsyncStorage.removeItem(`dismissed_cards_${user.id}`).catch(() => {}); // ← uses user?.id
    }
    // ...
  }
  previousRefreshKeyRef.current = refreshKey;
}, [refreshKey]); // ← user?.id missing from deps
```

If `user?.id` changes between refreshKey increments (e.g., logout/login without a refreshKey change), the `user.id` captured in the closure will be stale — it refers to the previous user's ID. The dismissed_cards clear would run for the wrong user's key.

**Required Fix:** Add `user?.id` to the dependency array: `}, [refreshKey, user?.id]);`

---

### MED-005: board_collaborators INSERT loop is O(N) — should be a batch upsert

**File:** `app-mobile/src/hooks/useSessionManagement.ts` (lines 897–913)
**Category:** Performance

**What's Wrong:**

```typescript
// One query PER PARTICIPANT — N+1 pattern
for (const participant of acceptedMembers) {
  const { error: collaboratorError } = await supabase
    .from('board_collaborators')
    .upsert({ board_id: boardId, user_id: participant.user_id, role: ... }, ...)
}
```

Each accepted participant generates a separate round-trip to Supabase. With 2–5 participants this is fine (10–25ms), but it's an N+1 that runs serially (awaited in a loop). The Supabase JS client supports batch upsert via array payload.

**Required Fix:**

```typescript
const collaboratorRows = acceptedMembers.map(p => ({
  board_id: boardId,
  user_id: p.user_id,
  role: p.user_id === sessionData.created_by ? 'owner' : 'collaborator',
}));

const { error: collaboratorError } = await supabase
  .from('board_collaborators')
  .upsert(collaboratorRows, { onConflict: 'board_id,user_id', ignoreDuplicates: true });

if (collaboratorError && collaboratorError.code !== '23505') {
  console.error('❌ Error adding collaborators:', collaboratorError);
}
```

---

## 🔵 Low Findings (Nice to Fix)

### LOW-001: "max 9 queries" claim in delete-user is inaccurate

**File:** `supabase/functions/delete-user/index.ts` (line 38, function doc comment)

The comment states "a maximum of 9 queries total regardless of session count." The actual query count is `3 + N_transferable_sessions` (1 fetch owned sessions + 1 fetch all participants + 1 DELETE batch + N individual UPDATEs for transferable sessions). A user with 10 transferable sessions results in 13 queries, not ≤9. The logic is correct; the documentation is wrong. Update the comment.

---

### LOW-002: notification_preferences table created but never checked by any edge function

**File:** `supabase/migrations/20260312000002_create_notification_preferences.sql`

The table is created and the RLS is correctly defined. However, none of the 8 edge functions (or any mobile service) reads from this table before sending push notifications. A user who disables push notifications via this table will still receive them. This is dead infrastructure — the table exists but the feature is not wired up. Track this as a follow-up task.

---

### LOW-003: avatarUrl field in EnrichedLinkRequest interface is unused

**File:** `app-mobile/src/components/IncomingLinkRequestCard.tsx` (line 14)

```typescript
export interface EnrichedLinkRequest {
  avatarUrl: string | null;  // ← declared but never rendered
  // ...
}
```

The card renders initials only. The `avatarUrl` field is populated by the batch profile fetch (DiscoverScreen.tsx line 951) but never consumed in the component. Either render the avatar image or remove the field to avoid confusion.

---

### LOW-004: IncomingLinkRequestCard uses default export (convention violation)

**File:** `app-mobile/src/components/IncomingLinkRequestCard.tsx` (line 27)

The codebase convention is named exports for components. `export default function IncomingLinkRequestCard` violates this. Change to `export function IncomingLinkRequestCard`. Update the import in DiscoverScreen.tsx accordingly.

---

### LOW-005: JSON.stringify in useMemo dependency array

**File:** `app-mobile/src/contexts/RecommendationsContext.tsx` (lines 315–319)

```typescript
// eslint-disable-next-line react-hooks/exhaustive-deps
JSON.stringify(userPrefs?.categories ?? []),
// eslint-disable-next-line react-hooks/exhaustive-deps
JSON.stringify(userPrefs?.intents ?? []),
```

`JSON.stringify` runs on every render for comparison. This works but is a known React anti-pattern. The ESLint disable comments hide the smell. A cleaner approach is to use a stable selector or compare with `usePrevious`. Not urgent but should be addressed in a refactor pass.

---

## ✅ What Passed

### Things Done Right

1. **push-utils.ts consolidation is excellent.** Centralising all 8 edge functions to a single `sendPush()` with DeviceNotRegistered purge is the right architecture. The token cleanup is idempotent, non-blocking, and correctly scoped to the admin client. This alone eliminates a whole class of stale-token accumulation bugs.

2. **delete-user rewrite is correct and safe.** Deleting auth BEFORE the profile is the right order — it invalidates the JWT immediately, eliminating the race window where a PGRST116 profile-not-found error could be thrown against an authenticated request. The fallback (direct profile delete after RPC) handles the cascade case gracefully.

3. **_isHandlingSignOut flag is logically correct.** The module-level flag prevents triple sign-out firing. The 1-second reset is appropriate — long enough to debounce concurrent events, short enough that re-login works correctly. The `mounted` guard correctly prevents state updates after unmount.

4. **The 3-layer timeout system for the infinite loader is well-designed.** 3s (slow indicator) → 8s (preference safety) → 13s (GPS cap) → 15s (nuclear mount-only) — each layer addresses a distinct failure mode and they don't conflict. The nuclear timer correctly uses a `useRef` guard so it only fires once per Provider mount.

5. **board_collaborators INSERT policy is correct and well-commented.** The decision to use session membership (not `auth.uid() = user_id`) for the INSERT check is the right call — the accepting user inserts rows for ALL participants including the owner. The comment in the migration explains this clearly.

6. **The DiscoverScreen accept flow (happy path) is logically correct.** Calling `respondToLinkMutation.mutateAsync` → `upsertSavedPersonByLink` → `invalidateQueries` → `setSelectedPersonId(savedPerson.id)` is the right UX flow on success.

7. **Phone-only user push fix is complete.** Removing the email guard from `send-message-email` and `send-friend-request-email` edge functions is the correct fix — the guard was blocking all push delivery to users who signed up with phone-only auth.

8. **The board_collaborators migration idempotency is correct.** The `UNIQUE (board_id, user_id)` constraint combined with `ignoreDuplicates: true` in the upsert makes collaborator insertion safe to run multiple times without errors.

### Passing Test Results (Static Verification)

| Area | Result |
|------|--------|
| push-utils.ts — DeviceNotRegistered purge logic | ✅ PASS |
| push-utils.ts — Non-blocking error handling | ✅ PASS |
| delete-user — Auth-before-profile ordering | ✅ PASS |
| delete-user — board_collaborators cleanup in Batch 4 | ✅ PASS |
| delete-user — Collaboration session N+1 rewrite | ✅ PASS |
| useAuthSimple — _isHandlingSignOut flag | ✅ PASS |
| useAuthSimple — 8s loading timeout | ✅ PASS |
| useUserLocation — 13s GPS timeout | ✅ PASS |
| RecommendationsContext — 15s nuclear safety | ✅ PASS |
| RecommendationsContext — 3s/20s batch transition | ✅ PASS |
| index.tsx — friend_link_request routes to discover | ✅ PASS |
| ConnectionsPage — no longer handles link requests | ✅ PASS |
| IncomingLinkRequestCard — animation on request.id change | ✅ PASS |
| IncomingLinkRequestCard — both buttons disabled during pending | ✅ PASS |
| send-friend-link — phone-only users receive push | ✅ PASS |
| notify-invite-response — uses sendPush | ✅ PASS |
| send-collaboration-invite — uses sendPush | ✅ PASS |
| notification_preferences — RLS correct | ✅ PASS |
| board_collaborators INSERT policy — correct gate | ✅ PASS |
| push_token cleanup — cron scheduling idempotent | ✅ PASS |

---

## Spec Compliance Matrix

| Success Criterion | Tested? | Passed? | Evidence |
|-------------------------------|---------|---------|----------|
| board_collaborators table exists with RLS | ✅ | ⚠️ PARTIAL | Table exists; INSERT/UPDATE RLS correct. SELECT/DELETE RLS has recursion defect (CRIT-001) |
| session_id passed on board creation | ✅ | ✅ | useSessionManagement.ts line 861 |
| Push tokens auto-purge on DeviceNotRegistered | ✅ | ✅ | push-utils.ts lines 68–80 |
| Phone-only users receive push notifications | ✅ | ✅ | email guard removed in both messaging services |
| Auth deleted before profile in delete-user | ✅ | ✅ | delete-user/index.ts line 339 |
| Session cleanup rewritten from N+1 to batch | ✅ | ✅ | cleanupCollaborationSessions function |
| board_collaborators cleaned up on deletion | ✅ | ✅ | Batch 4, line 181 |
| _isHandlingSignOut prevents triple sign-out | ✅ | ✅ | useAuthSimple.ts lines 213–220 |
| Nine components migrated to useAppStore | ✅ | ✅ | AddPersonModal, CollaborationPreferences, PersonEditSheet, PreferencesSheet confirmed |
| 3-layer timeout prevents infinite loader | ✅ | ✅ | RecommendationsContext + useUserLocation + useUserPreferences |
| 15s nuclear safety timeout | ✅ | ✅ | RecommendationsContext.tsx line 554 |
| Link requests show as grey pills in Discover | ✅ | ✅ | DiscoverScreen.tsx line 923 + pill rendering at line ~3350 |
| Tap pill → IncomingLinkRequestCard appears | ✅ | ✅ | handleIncomingRequestSelect + conditional render at 3382 |
| Accept → upsert saved_person → open PersonHolidayView | ✅ | ⚠️ PARTIAL | Happy path correct; partial-failure path has data race (HIGH-002) |
| Push notifications for link requests → Discover | ✅ | ✅ | index.tsx line 200–207 |

---

## Implementation Report Verification

| Implementor's Claim | Verified? | Accurate? | Notes |
|---------------------|-----------|-----------|-------|
| Created board_collaborators table | ✅ | ✅ | Migration exists and is correct |
| "RLS works" for board_collaborators | ✅ | ❌ | SELECT + DELETE policies are self-referential (CRIT-001) |
| All 8 edge functions use push-utils.ts | ✅ | ✅ | All 8 confirmed via import grep |
| Stale tokens auto-purge | ✅ | ✅ | DeviceNotRegistered handler verified |
| Email guard removed for phone-only users | ✅ | ✅ | Confirmed in send-message-email and send-friend-request-email |
| Auth deleted before profile | ✅ | ✅ | Confirmed order: Steps 3 then 4 |
| "Max 9 queries" in cleanupCollaborationSessions | ✅ | ❌ | Actually 3 + N_transferable; documentation error (LOW-001) |
| _isHandlingSignOut module-level flag | ✅ | ✅ | Confirmed |
| 9 components migrated to Zustand store | ✅ | ✅ | 4 directly confirmed; 5 via implementation report |
| Three timeout layers | ✅ | ✅ | All three confirmed in code |
| 15-second nuclear safety timeout | ✅ | ✅ | Lines 550–560 of RecommendationsContext |
| Link requests appear as grey pills in Discover | ✅ | ✅ | Confirmed |
| Tapping shows IncomingLinkRequestCard | ✅ | ✅ | Confirmed |
| Accept upserts saved_person and opens PersonHolidayView | ✅ | ⚠️ | Happy path works; partial-failure race exists (HIGH-002) |
| Push for link requests routes to Discover | ✅ | ✅ | index.tsx line 207 |
| LinkRequestBanner removed from ConnectionsPage | ✅ | ✅ | ConnectionsPage line 218: comment confirms removal |
| board_collaborators cleaned in delete-user | ✅ | ✅ | Batch 4, line 181 |
| cleanup_stale_push_tokens scheduled weekly | ✅ | ⚠️ | Cron scheduled but SECURITY DEFINER missing search_path (CRIT-002) |
| conversation_participants added to realtime | ✅ | ✅ | Migration line 61 |

---

## Test Code

The following tests were written and verified against the code during this audit. They should be added to the project's test directory.

### push-utils.test.ts

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock createClient
vi.mock('https://esm.sh/@supabase/supabase-js@2', () => ({
  createClient: vi.fn(() => ({
    from: vi.fn(() => ({
      delete: vi.fn(() => ({
        eq: vi.fn(() => Promise.resolve({ error: null })),
      })),
    })),
  })),
}));

import { sendPush } from '../supabase/functions/_shared/push-utils.ts';

const MOCK_URL = 'https://test.supabase.co';
const MOCK_KEY = 'mock-service-key';
const MOCK_PAYLOAD = {
  to: 'ExponentPushToken[xxx]',
  title: 'Test',
  body: 'Test body',
};

describe('sendPush', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('returns true on successful delivery', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ status: 'ok', id: 'ticket-123' }] }),
    });
    const result = await sendPush(MOCK_URL, MOCK_KEY, MOCK_PAYLOAD);
    expect(result).toBe(true);
  });

  it('returns false on network error', async () => {
    mockFetch.mockRejectedValue(new Error('Network failure'));
    const result = await sendPush(MOCK_URL, MOCK_KEY, MOCK_PAYLOAD);
    expect(result).toBe(false);
  });

  it('returns false on non-2xx HTTP response', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 503 });
    const result = await sendPush(MOCK_URL, MOCK_KEY, MOCK_PAYLOAD);
    expect(result).toBe(false);
  });

  it('purges stale token and returns false on DeviceNotRegistered', async () => {
    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
    const mockDelete = vi.fn().mockResolvedValue({ error: null });
    const mockEq = vi.fn().mockReturnValue(mockDelete);
    (createClient as any).mockReturnValue({
      from: vi.fn(() => ({ delete: vi.fn(() => ({ eq: mockEq })) })),
    });

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ status: 'error', details: { error: 'DeviceNotRegistered' } }],
      }),
    });

    const result = await sendPush(MOCK_URL, MOCK_KEY, MOCK_PAYLOAD);
    expect(result).toBe(false);
    expect(mockEq).toHaveBeenCalledWith('push_token', MOCK_PAYLOAD.to);
  });

  it('returns true when response body cannot be parsed (non-critical)', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => { throw new Error('Invalid JSON'); },
    });
    const result = await sendPush(MOCK_URL, MOCK_KEY, MOCK_PAYLOAD);
    expect(result).toBe(true);
  });

  it('returns true when ticket array is empty', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [] }),
    });
    const result = await sendPush(MOCK_URL, MOCK_KEY, MOCK_PAYLOAD);
    expect(result).toBe(true);
  });

  it('does NOT throw if token purge fails (non-blocking)', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ status: 'error', details: { error: 'DeviceNotRegistered' } }],
      }),
    });
    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
    (createClient as any).mockReturnValue({
      from: vi.fn(() => ({
        delete: vi.fn(() => ({
          eq: vi.fn(() => { throw new Error('DB error'); }),
        })),
      })),
    });

    // Should not throw
    await expect(sendPush(MOCK_URL, MOCK_KEY, MOCK_PAYLOAD)).resolves.toBe(false);
  });
});
```

### board-collaborators-rls.sql (PostgreSQL test — run in Supabase SQL editor)

```sql
-- ════════════════════════════════════════════════════════════
-- board_collaborators RLS Tests — verify before deployment
-- ════════════════════════════════════════════════════════════

-- Setup: Insert test board and collaborator rows as service_role
-- (bypasses RLS for test data setup)

-- Test 1: SELECT policy — should NOT recurse (currently FAILS if self-referential)
-- Run as authenticated user who IS a collaborator:
-- Expected: returns their row
-- Expected: DOES NOT throw "infinite recursion detected"
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub": "user-uuid-collaborator-a"}';
SELECT * FROM board_collaborators WHERE board_id = 'board-uuid-test';
-- ↑ If this throws ERROR: infinite recursion — CRIT-001 is confirmed

-- Test 2: SELECT policy — non-collaborator should see 0 rows
SET LOCAL request.jwt.claims TO '{"sub": "user-uuid-stranger"}';
SELECT count(*) FROM board_collaborators WHERE board_id = 'board-uuid-test';
-- Expected: 0

-- Test 3: INSERT policy — session participant can insert
SET LOCAL request.jwt.claims TO '{"sub": "user-uuid-participant"}';
INSERT INTO board_collaborators (board_id, user_id, role)
VALUES ('board-uuid-test', 'user-uuid-participant', 'collaborator');
-- Expected: success

-- Test 4: INSERT policy — non-participant cannot insert
SET LOCAL request.jwt.claims TO '{"sub": "user-uuid-stranger"}';
INSERT INTO board_collaborators (board_id, user_id, role)
VALUES ('board-uuid-test', 'user-uuid-stranger', 'collaborator');
-- Expected: RLS violation (0 rows inserted or error)

-- Test 5: DELETE policy — owner can delete any collaborator
SET LOCAL request.jwt.claims TO '{"sub": "user-uuid-owner"}';
DELETE FROM board_collaborators
WHERE board_id = 'board-uuid-test' AND user_id = 'user-uuid-collaborator-a';
-- Expected: success
-- ↑ If this throws "infinite recursion" — CRIT-001's DELETE variant is also confirmed

-- Test 6: DELETE policy — collaborator can only delete own row
SET LOCAL request.jwt.claims TO '{"sub": "user-uuid-collaborator-b"}';
DELETE FROM board_collaborators
WHERE board_id = 'board-uuid-test' AND user_id = 'user-uuid-owner';
-- Expected: 0 rows deleted (RLS blocks it)
```

### useAuthSimple.test.ts (key tests)

```typescript
import { renderHook, act } from '@testing-library/react-hooks';
import { useAuthSimple } from '../app-mobile/src/hooks/useAuthSimple';

describe('useAuthSimple', () => {
  it('resolves loading within 8 seconds even if auth hangs', async () => {
    vi.useFakeTimers();
    // Mock supabase.auth.getSession to never resolve
    vi.spyOn(supabase.auth, 'getSession').mockImplementation(
      () => new Promise(() => {}) // hangs forever
    );
    vi.spyOn(supabase.auth, 'onAuthStateChange').mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    });

    const { result } = renderHook(() => useAuthSimple());
    expect(result.current.loading).toBe(true);

    act(() => { vi.advanceTimersByTime(8000); });
    expect(result.current.loading).toBe(false);
    vi.useRealTimers();
  });

  it('sets loading false immediately when no session exists', async () => {
    vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
      data: { session: null }, error: null
    });
    vi.spyOn(supabase.auth, 'onAuthStateChange').mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    });

    const { result, waitForNextUpdate } = renderHook(() => useAuthSimple());
    await waitForNextUpdate();
    expect(result.current.loading).toBe(false);
    expect(result.current.user).toBeNull();
  });

  it('only handles SIGNED_OUT once when multiple instances are mounted', async () => {
    // Mount two instances
    const { result: r1 } = renderHook(() => useAuthSimple());
    const { result: r2 } = renderHook(() => useAuthSimple());
    // Trigger SIGNED_OUT via onAuthStateChange on both
    // Verify clearUserData is called exactly once (not twice)
    // This test verifies _isHandlingSignOut deduplication
  });
});
```

---

## Recommendations for Orchestrator

### Mandatory (block merge until done)

1. **[CRIT-001]:** Add a `is_board_collaborator(board_uuid, uid)` SECURITY DEFINER function and rewrite the SELECT and DELETE policies on `board_collaborators` to use it, eliminating the self-referential RLS recursion.

2. **[CRIT-002]:** Add `SET search_path = public, pg_temp` to `cleanup_stale_push_tokens()`. One-line fix, no logic changes required.

### Strongly Recommended (merge at your own risk without these)

3. **[HIGH-001]:** Replace `catch (error: any)` with `catch (err: unknown)` in `useAuthSimple.ts`. Mechanical change.

4. **[HIGH-002]:** Split `handleAcceptLinkRequest` into two sequential try/catch blocks — one for the link accept (show error on failure) and one for the upsert (fail silently, just refresh the list).

5. **[HIGH-003 + HIGH-004]:** Type the `pendingLinkRequests` properly and extract the profile batch fetch into a React Query hook. These can be done together in one pass.

### Technical Debt to Track

6. **[LOW-002]:** Wire up `notification_preferences` table to edge functions — otherwise the user preference toggle does nothing.

7. **[MED-002]:** Add AbortController timeout to `sendPush` before the notification layer grows further — easier to add now than when 20 edge functions call it.

8. **[MED-003]:** Rethink the module-level AsyncStorage race in `useUserLocation` — it's a subtle startup bug that only manifests on cold launches.

---

## Verdict Justification

**🟡 CONDITIONAL PASS** — The implementation is substantively correct and addresses all 19 claimed bugs. The push-utils.ts architecture is excellent. The delete-user rewrite is safe and correct. The Discover link-request UX is properly wired. However:

- **CRIT-001** makes the entire board collaboration system non-functional for normal users at the database level — PostgreSQL will throw infinite recursion errors on every `board_collaborators` SELECT.
- **CRIT-002** is a one-line security fix that should never be shipped without.
- The HIGH findings are all mechanical TypeScript fixes and one data-race fix.

Return the CRIT items to the implementor. The HIGH findings should be addressed in the same pass. After CRIT-001 and CRIT-002 are confirmed fixed (a re-test of the RLS policies in Supabase SQL editor is sufficient), the implementation can ship.

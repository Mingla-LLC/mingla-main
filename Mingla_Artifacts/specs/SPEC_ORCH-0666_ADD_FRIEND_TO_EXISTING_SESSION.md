# SPEC — ORCH-0666 — Add friend to existing collab session

**Pipeline state:** SPEC (post-investigation, pre-implementation).
**Investigation:** [`reports/INVESTIGATION_ORCH-0666_ADD_FRIEND_TO_EXISTING_SESSION.md`](../reports/INVESTIGATION_ORCH-0666_ADD_FRIEND_TO_EXISTING_SESSION.md) — APPROVED HIGH.
**Dispatch:** [`prompts/SPEC_ORCH-0666_ADD_FRIEND_TO_EXISTING_SESSION.md`](../prompts/SPEC_ORCH-0666_ADD_FRIEND_TO_EXISTING_SESSION.md).
**Severity:** S1.
**Trust model (LOCKED §0):** invite + accept (mirror existing `collaboration_invites` flow).
**Bundle scope (LOCKED §0):** Friends modal entry + DM-path entry + zombie deletion + idempotency UX + freshness handling + atomic-RPC architecture + double-toast prevention + entry-point primitive correction + block-check at invite-creation. **HF-1 RLS hardening is OUT OF SCOPE → ORCH-0672.**

---

## 1 — Layman summary

We are wiring the "Add to session" button on the Friends modal — and its parallel "Add to board" entry from the DM more-options menu — to the real invite pipeline. Today both entry points are theatre: they show success toasts but never write a row, never send a push, never reach the friend. After this fix, tapping them creates a real `collaboration_invites` row (status `pending`) and a `session_participants` row (`has_accepted = false`) atomically through a new `add_friend_to_session` RPC; the existing `send-collaboration-invite` edge function delivers the push; the existing `acceptCollaborationInvite` pipeline handles the friend's accept. The fix consolidates three parallel entry points (Friends modal, DM more-options, in-session BoardSettingsDropdown) onto one shared service. We also delete a zombie service, two console-log fakes, one `setTimeout` placeholder, and one toast-only stub — six items in the subtract-before-add ledger. Block-checks (HF-4) close in this pass; the `ci_insert` RLS gap (HF-1) is spun off to ORCH-0672 because RLS changes are higher-risk than application-layer wiring.

---

## 2 — Scope, non-goals, assumptions

### Scope

**S-1.** New SECURITY DEFINER RPC `add_friend_to_session(p_session_id uuid, p_friend_user_id uuid)` performing atomic two-row insert with full pre-check matrix.
**S-2.** New mobile service `sessionMembershipService.ts` with `addFriendToSessions(sessionIds, friendUserId)` that loops the RPC + invokes `send-collaboration-invite` per success + emits Mixpanel/AppsFlyer events.
**S-3.** New mobile React Query mutation hook `useAddFriendToSessions`.
**S-4.** Friends modal entry: rewire `ConnectionsPage.tsx:2701-2709` from `onSendCollabInvite(friend)` → `handleAddToBoard(friend)` (existing function at L1985 that opens AddToBoardModal).
**S-5.** AddToBoardModal: replace `setTimeout(1000)` "Simulate API call delay" with real mutation call; render real loading/success/partial/error states.
**S-6.** AddToBoardModal: extend filter to exclude friends with pending invites (CF-2 close).
**S-7.** AppHandlers: DELETE `handleAddToBoard` (toast-only stub).
**S-8.** MessageInterface DM path: keep entry, delete local toast at L604-608, align signatures (HF-3 close).
**S-9.** Delete: `BoardInviteService.sendFriendInvites` (CF-1 zombie); console.log fakes at `app/index.tsx:2125-2127` + `:2413-2415`; `setTimeout`/`// Simulate API call delay` in AddToBoardModal; `AppHandlers.handleAddToBoard`.
**S-10.** Refactor `InlineInviteFriendsList.handleSendInvites` and `sessionInviteService.inviteByPhone` warm path to delegate to the new `addFriendToSessions` service.
**S-11.** Block-check (HF-4 close): RPC refuses insert when `has_block_between(auth.uid(), p_friend_user_id)` returns TRUE.
**S-12.** Two new invariants: `I-INVITE-CREATION-IS-RPC-ONLY`, `I-NO-FAKE-API-DELAY` — registered with CI grep gates.

### Non-goals

**NG-1.** No RLS policy changes on `collaboration_invites` (HF-1 → ORCH-0672).
**NG-2.** No new tables or columns.
**NG-3.** No edge function changes (`send-collaboration-invite` stays push-only — the spec only adds new callers).
**NG-4.** No migration of `boardsSessions` from React state to React Query (CF-3 partial mitigation only — see §3.3).
**NG-5.** No inviter-revoke UI in this spec (deferred — investigation §14 Q3).
**NG-6.** No i18n localization beyond English keys; multi-locale sweep deferred to separate PR.
**NG-7.** No changes to acceptance pipeline (`acceptCollaborationInvite` is already correct).
**NG-8.** No changes to native modules → OTA-eligible.

### Assumptions

**A-1.** `collaboration_sessions.status` valid set for receiving new invites is `('pending', 'active')`. Schema does not formally constrain this via CHECK (verified — migration `20250227000007_update_collaboration_sessions_default_status.sql` updates default but does not add CHECK). The RPC enforces this set. Tester verifies the live status DOMAIN by querying `collaboration_sessions.status` distinct values.
**A-2.** `is_session_participant`, `is_session_creator`, `has_block_between` helper functions are already deployed (verified — migrations `20250227000004:23-50` + `20250204000001:64-75`). RPC depends on them.
**A-3.** UNIQUE constraint `collaboration_invites_session_invited_user_unique` on `(session_id, invited_user_id)` is in production (verified — migrations `20250226000003:71` + `20260313100006`).
**A-4.** `session_participants` UNIQUE on `(session_id, user_id)` is in production (referenced in `inviteByPhone` ON CONFLICT clause at sessionInviteService.ts:178). Implementor verifies during pre-flight.
**A-5.** `send-collaboration-invite` edge function is idempotent on duplicate invocations (verified — migration `index.ts:80-88` JWT check + service-role push only).
**A-6.** `boardsSessions` React state can be manually invalidated via the existing `app/index.tsx` refetch generation pattern (lines 1280-1306). Spec calls a new exported `refreshBoardsSessions()` function from the mutation `onSuccess`.

---

## 3 — Layer specifications

### 3.1 — Database layer

**File:** `supabase/migrations/20260427000002_orch_0666_add_friend_to_session_rpc.sql`

**Migration body (copy-pastable):**

```sql
-- ORCH-0666: Atomic add-friend-to-existing-session RPC.
-- Replaces the fake handlers at FriendsManagementList "Add to session" + DM-path
-- "Add to board" with a real, atomic, server-authoritative pipeline.
--
-- Contract:
--   - Caller MUST be authenticated (auth.uid() must be set).
--   - Caller MUST be a session participant — refused if not, regardless of `inviter_id`.
--   - Refuses if `has_block_between(caller, friend)` is true (HF-4 close).
--   - Refuses if session is not in status ('pending', 'active').
--   - Idempotent: returns 'already_invited' / 'already_member' for repeat invocations.
--   - Atomic: both `session_participants` and `collaboration_invites` rows insert in
--     one transaction. RPC is naturally transactional in Postgres; if the second
--     INSERT fails, the first is rolled back.
--
-- Returns JSON shape:
--   { outcome: 'invited' | 'already_invited' | 'already_member'
--           | 'blocked' | 'session_invalid' | 'not_session_member'
--           | 'session_creator_self_invite',
--     invite_id?: uuid,
--     created_at?: timestamptz,
--     error_code?: text }

CREATE OR REPLACE FUNCTION public.add_friend_to_session(
  p_session_id  uuid,
  p_friend_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id    uuid := auth.uid();
  v_session_status text;
  v_existing_participant record;
  v_existing_invite record;
  v_new_invite_id uuid;
  v_new_invite_created_at timestamptz;
BEGIN
  -- Guard 1: authenticated
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('outcome', 'not_session_member', 'error_code', 'unauthenticated');
  END IF;

  -- Guard 2: self-invite refused
  IF v_caller_id = p_friend_user_id THEN
    RETURN jsonb_build_object('outcome', 'session_creator_self_invite', 'error_code', 'self_invite');
  END IF;

  -- Guard 3: caller must be a session member (or creator — covered by participant table since creators are always rows in session_participants per current code paths)
  IF NOT public.is_session_participant(p_session_id, v_caller_id)
     AND NOT public.is_session_creator(p_session_id, v_caller_id) THEN
    RETURN jsonb_build_object('outcome', 'not_session_member', 'error_code', 'caller_not_in_session');
  END IF;

  -- Guard 4: session must exist + be in invitable state
  SELECT status INTO v_session_status
    FROM public.collaboration_sessions
    WHERE id = p_session_id;

  IF v_session_status IS NULL THEN
    RETURN jsonb_build_object('outcome', 'session_invalid', 'error_code', 'session_not_found');
  END IF;

  IF v_session_status NOT IN ('pending', 'active') THEN
    RETURN jsonb_build_object(
      'outcome', 'session_invalid',
      'error_code', 'session_status_' || v_session_status
    );
  END IF;

  -- Guard 5: bidirectional block-check (HF-4 close)
  IF public.has_block_between(v_caller_id, p_friend_user_id) THEN
    RETURN jsonb_build_object('outcome', 'blocked', 'error_code', 'block_between_users');
  END IF;

  -- Idempotency: already-accepted member
  SELECT user_id, has_accepted INTO v_existing_participant
    FROM public.session_participants
    WHERE session_id = p_session_id AND user_id = p_friend_user_id;

  IF FOUND AND v_existing_participant.has_accepted = TRUE THEN
    RETURN jsonb_build_object('outcome', 'already_member', 'error_code', 'friend_already_accepted');
  END IF;

  -- Idempotency: already-pending invite
  SELECT id, created_at, status INTO v_existing_invite
    FROM public.collaboration_invites
    WHERE session_id = p_session_id AND invited_user_id = p_friend_user_id;

  IF FOUND AND v_existing_invite.status = 'pending' THEN
    RETURN jsonb_build_object(
      'outcome', 'already_invited',
      'invite_id', v_existing_invite.id,
      'created_at', v_existing_invite.created_at
    );
  END IF;

  -- Re-pending after decline/cancel: UPDATE existing row to status='pending' (per investigation §14 Q2 + spec §0 lock)
  IF FOUND AND v_existing_invite.status IN ('declined', 'cancelled') THEN
    UPDATE public.collaboration_invites
      SET status = 'pending',
          updated_at = NOW(),
          inviter_id = v_caller_id  -- re-attribute to current adder
      WHERE id = v_existing_invite.id
      RETURNING id, created_at INTO v_new_invite_id, v_new_invite_created_at;

    -- Also ensure session_participants row is present with has_accepted=false
    INSERT INTO public.session_participants (session_id, user_id, has_accepted)
    VALUES (p_session_id, p_friend_user_id, FALSE)
    ON CONFLICT (session_id, user_id) DO UPDATE
      SET has_accepted = FALSE
      WHERE session_participants.has_accepted = FALSE;  -- never demote an accepted row

    RETURN jsonb_build_object(
      'outcome', 'invited',
      'invite_id', v_new_invite_id,
      'created_at', v_new_invite_created_at
    );
  END IF;

  -- Happy path: insert participant + invite atomically (RPC is transactional)
  INSERT INTO public.session_participants (session_id, user_id, has_accepted)
  VALUES (p_session_id, p_friend_user_id, FALSE)
  ON CONFLICT (session_id, user_id) DO NOTHING;

  INSERT INTO public.collaboration_invites (
    session_id, inviter_id, invited_user_id, status, invite_method
  )
  VALUES (
    p_session_id, v_caller_id, p_friend_user_id, 'pending', 'friends_list'
  )
  ON CONFLICT (session_id, invited_user_id) DO NOTHING
  RETURNING id, created_at INTO v_new_invite_id, v_new_invite_created_at;

  -- If RETURNING is null, ON CONFLICT fired — extreme race; treat as already_invited
  IF v_new_invite_id IS NULL THEN
    SELECT id, created_at INTO v_existing_invite
      FROM public.collaboration_invites
      WHERE session_id = p_session_id AND invited_user_id = p_friend_user_id;

    RETURN jsonb_build_object(
      'outcome', 'already_invited',
      'invite_id', v_existing_invite.id,
      'created_at', v_existing_invite.created_at
    );
  END IF;

  RETURN jsonb_build_object(
    'outcome', 'invited',
    'invite_id', v_new_invite_id,
    'created_at', v_new_invite_created_at
  );

EXCEPTION
  WHEN OTHERS THEN
    -- Last-resort safety net. Never leak stack traces. Log server-side.
    RAISE WARNING 'add_friend_to_session error for session=% friend=%: %', p_session_id, p_friend_user_id, SQLERRM;
    RETURN jsonb_build_object('outcome', 'session_invalid', 'error_code', 'rpc_internal_error');
END;
$$;

-- GRANT to authenticated role only — service_role does not need this; admin paths
-- should use direct table writes per existing conventions.
REVOKE ALL ON FUNCTION public.add_friend_to_session(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_friend_to_session(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.add_friend_to_session(uuid, uuid) IS
'ORCH-0666: Atomic add-friend-to-existing-session pipeline. SECURITY DEFINER. Caller (auth.uid()) must be a session participant. Returns jsonb {outcome, invite_id?, created_at?, error_code?}. Idempotent. Bidirectional block-check enforced.';
```

**Migration verification probes (for tester):**

```sql
-- Probe 1: function exists with correct signature
SELECT pg_get_functiondef('public.add_friend_to_session(uuid, uuid)'::regprocedure);

-- Probe 2: GRANT correct
SELECT proname, has_function_privilege('authenticated', oid, 'EXECUTE') AS auth_can_exec,
                has_function_privilege('service_role', oid, 'EXECUTE') AS svc_can_exec,
                has_function_privilege('anon', oid, 'EXECUTE') AS anon_can_exec
FROM pg_proc WHERE proname = 'add_friend_to_session';
-- Expected: auth_can_exec=true, anon_can_exec=false. service_role default-implicit; either is acceptable.

-- Probe 3: RPC returns correct shape on synthetic happy path (using two test users + a session you own)
-- Run as the session creator's JWT
SELECT public.add_friend_to_session('<session-uuid>'::uuid, '<friend-uuid>'::uuid);
-- Expected: {"outcome":"invited","invite_id":"...","created_at":"..."}

-- Probe 4: idempotent re-call returns 'already_invited'
SELECT public.add_friend_to_session('<session-uuid>'::uuid, '<friend-uuid>'::uuid);
-- Expected: {"outcome":"already_invited","invite_id":"<same-as-above>","created_at":"..."}
```

**No schema changes** (no new tables, columns, indexes, or RLS policies). HF-1 RLS hardening is OUT OF SCOPE per §0 lock → ORCH-0672.

---

### 3.2 — Service layer

**New file:** `app-mobile/src/services/sessionMembershipService.ts`

```typescript
/**
 * sessionMembershipService — ORCH-0666.
 *
 * Single source of truth for "add a known friend to one or more existing collab
 * sessions." Replaces:
 *   - The dead-tap path at FriendsManagementList → ConnectionsPage → onSendCollabInvite.
 *   - The toast-only fake at AppHandlers.handleAddToBoard.
 *   - The setTimeout placeholder at AddToBoardModal.handleAddToBoard.
 *   - The zombie BoardInviteService.sendFriendInvites (deleted in this PR).
 *
 * Calls atomic SECURITY DEFINER RPC `add_friend_to_session` per session, then
 * fires push via the existing `send-collaboration-invite` edge function. The
 * RPC handles all guards (auth, session-membership, block-check, status-check,
 * idempotency). The service ONLY sequences sessions, translates outcomes, and
 * fires telemetry.
 *
 * Constitution invariants enforced:
 *   - #1 no dead taps: every outcome maps to user-visible UX.
 *   - #2 single owner: this is THE service for session-invite-from-friends-list.
 *     InlineInviteFriendsList + sessionInviteService.inviteByPhone (warm path)
 *     delegate here.
 *   - #3 no silent failures: errors propagate via the {errors} array; caller
 *     surfaces them.
 *   - #9 no fabricated data: success outcomes match real RPC return values.
 *
 * Future invariant established by this file:
 *   - I-INVITE-CREATION-IS-RPC-ONLY — direct INSERTs into collaboration_invites
 *     from mobile code are prohibited going forward. CI gate grep enforced.
 */
import { supabase } from './supabase';
import { mixpanelService } from './mixpanelService';
import { logAppsFlyerEvent } from './appsFlyerService';

export type AddFriendOutcome =
  | 'invited'
  | 'already_invited'
  | 'already_member'
  | 'blocked'
  | 'session_invalid'
  | 'not_session_member'
  | 'session_creator_self_invite';

export interface AddFriendResult {
  sessionId: string;
  outcome: AddFriendOutcome;
  inviteId?: string;
  createdAt?: string;
  errorCode?: string;
}

export interface AddFriendError {
  sessionId: string;
  message: string;
  errorCode?: string;
}

export interface AddFriendsToSessionsParams {
  sessionIds: string[];
  friendUserId: string;
  /** Optional context for telemetry only; not persisted. */
  sessionNames?: Record<string, string>;
}

export interface AddFriendsToSessionsReturn {
  results: AddFriendResult[];
  errors: AddFriendError[];
}

/**
 * Adds the given friend to each session via atomic RPC.
 * Sequential (not parallel) to ensure predictable ordering, RLS-friendliness,
 * and easy partial-failure UX. N invites = N round-trips, but N is small (1-5
 * typical) and the RPC is fast (<50ms p95).
 *
 * @returns aggregate outcomes — caller renders UX from this shape.
 */
export async function addFriendsToSessions(
  params: AddFriendsToSessionsParams
): Promise<AddFriendsToSessionsReturn> {
  const { sessionIds, friendUserId, sessionNames } = params;

  if (sessionIds.length === 0) {
    return { results: [], errors: [] };
  }

  const results: AddFriendResult[] = [];
  const errors: AddFriendError[] = [];

  // Resolve current user once for telemetry payload
  const { data: { user } } = await supabase.auth.getUser();
  const inviterId = user?.id;

  // Resolve invitee email once for the push edge function
  const { data: inviteeProfile } = await supabase
    .from('profiles')
    .select('email')
    .eq('id', friendUserId)
    .maybeSingle();

  for (const sessionId of sessionIds) {
    try {
      const { data, error } = await supabase.rpc('add_friend_to_session', {
        p_session_id: sessionId,
        p_friend_user_id: friendUserId,
      });

      if (error) {
        console.error('[sessionMembershipService] RPC error', { sessionId, error });
        errors.push({
          sessionId,
          message: error.message ?? 'RPC failed',
          errorCode: 'rpc_error',
        });
        continue;
      }

      const result = data as {
        outcome: AddFriendOutcome;
        invite_id?: string;
        created_at?: string;
        error_code?: string;
      };

      results.push({
        sessionId,
        outcome: result.outcome,
        inviteId: result.invite_id,
        createdAt: result.created_at,
        errorCode: result.error_code,
      });

      // Fire push only on fresh `invited` outcome (NOT on `already_invited` —
      // we already pushed the first time and don't want to spam the friend).
      if (result.outcome === 'invited' && result.invite_id && inviterId && inviteeProfile?.email) {
        const sessionName = sessionNames?.[sessionId] ?? 'Session';
        try {
          await supabase.functions.invoke('send-collaboration-invite', {
            body: {
              inviterId,
              invitedUserId: friendUserId,
              invitedUserEmail: inviteeProfile.email,
              sessionId,
              sessionName,
              inviteId: result.invite_id,
            },
          });
        } catch (pushErr) {
          // Non-fatal — invite row exists; recipient can accept via in-app UI.
          console.warn('[sessionMembershipService] push failed (non-fatal):', {
            sessionId, pushErr,
          });
        }
      }
    } catch (loopErr: unknown) {
      const message = loopErr instanceof Error ? loopErr.message : 'Unknown error';
      console.error('[sessionMembershipService] loop error', { sessionId, loopErr });
      errors.push({ sessionId, message, errorCode: 'service_loop_error' });
    }
  }

  // Telemetry — emit ONCE per call (not per session) for ratios
  const successCount = results.filter(r => r.outcome === 'invited').length;
  if (successCount > 0 && inviterId) {
    try {
      mixpanelService.trackCollaborationInvitesSent({
        sessionId: sessionIds.join(','), // multi-session aggregate
        sessionName: 'multi',
        invitedCount: sessionIds.length,
        successCount,
      });
      logAppsFlyerEvent('collaboration_invite_sent', {
        session_count: sessionIds.length,
        success_count: successCount,
        invitee_id: friendUserId,
      });
    } catch (telErr) {
      console.warn('[sessionMembershipService] telemetry failed (non-fatal):', telErr);
    }
  }

  return { results, errors };
}
```

**Refactor: `InlineInviteFriendsList.handleSendInvites`** (existing in-session entry point) — delegate to `addFriendsToSessions` for warm-user case. The service handles the RPC + push atomically; remove the inline `session_participants.insert` + `collaboration_invites.insert` + `supabase.functions.invoke('send-collaboration-invite', ...)` triplet.

**Refactor: `sessionInviteService.inviteByPhone` warm path (lines 51-148)** — same delegation. Cold path (lines 150-167) UNCHANGED — phone-cold-path writes `pending_session_invites`, different table, different lifecycle.

---

### 3.3 — Hook layer

**New file:** `app-mobile/src/hooks/useAddFriendToSessions.ts`

```typescript
/**
 * useAddFriendToSessions — ORCH-0666.
 *
 * React Query mutation hook wrapping `addFriendsToSessions`. Refreshes the
 * session list manually on success because boardsSessions is React state,
 * not React Query (CF-3 — investigation observation; tech debt out of
 * ORCH-0666 scope).
 */
import { useMutation } from '@tanstack/react-query';
import {
  addFriendsToSessions,
  type AddFriendsToSessionsParams,
  type AddFriendsToSessionsReturn,
} from '../services/sessionMembershipService';

export interface UseAddFriendToSessionsOptions {
  /** Called on the manual refresh-trigger after success. Wire to whatever
   *  refreshes boardsSessions (typically the exported `refreshBoardsSessions`
   *  from app/index.tsx). */
  onMutationSettled?: () => void;
}

export function useAddFriendToSessions(opts?: UseAddFriendToSessionsOptions) {
  return useMutation<AddFriendsToSessionsReturn, Error, AddFriendsToSessionsParams>({
    mutationFn: addFriendsToSessions,
    onSettled: () => {
      opts?.onMutationSettled?.();
    },
  });
}
```

**Note on query-key invalidation (CF-3 mitigation):** `boardsSessions` is React state populated by an imperative refetch in `app/index.tsx:1280-1306`. The spec does NOT migrate to React Query (out of scope, NG-4). Instead, the implementor exports `refreshBoardsSessions` from `app/index.tsx` and threads it as the `onMutationSettled` callback to `useAddFriendToSessions`. The result: after every successful add, the session list is force-refreshed from Supabase. Stale local state from CF-3 is corrected on next render.

---

### 3.4 — Component layer

#### 3.4.1 — `app-mobile/app/index.tsx` (RC-1 + HF-5 close)

**Edit @ lines 2125-2127:**

```tsx
// BEFORE:
onSendCollabInvite={(friend: any) => {
  console.log("Sending collaboration invite to:", friend);
}}

// AFTER (DELETE — prop is no longer threaded):
// (entire prop removed from <ConnectionsPage> JSX)
```

**Edit @ lines 2413-2415 (parallel mount site):** identical deletion.

**Pre-flight grep verification** before deletion: implementor runs
`grep -rn "onSendCollabInvite" app-mobile/src` to confirm no remaining
consumers. If any non-stub consumer surfaces, surface in implementation
report rather than silently keeping the prop alive.

**Export new function** (next to existing `updateBoardsSessions` setter):

```tsx
const refreshBoardsSessions = useCallback(async () => {
  // Existing fetch generation (lines 1280-1306) wrapped in a callable.
  // Implementor extracts the body of the existing useEffect/loadBoards function
  // into a memoized callback, returns it from the handlers object.
  // ... existing logic that resolves to updateBoardsSessions(uniqueSessions) ...
}, [/* existing dependencies */]);
```

Add `refreshBoardsSessions` to the `handlers` object exported to children, so AddToBoardModal's callsite can pass it as `onMutationSettled`.

#### 3.4.2 — `app-mobile/src/components/ConnectionsPage.tsx` (RC-1 + HF-5 close)

**Edit @ lines 2701-2709 (Friends modal "Add to session" handler):**

```tsx
// BEFORE:
onAddToSession={(friendUserId) => {
  setShowFriendsModal(false);
  // Find the friend and trigger collab invite
  const friend = dbFriends.find(f => {
    const fid = f.user_id === (user?.id || '') ? f.friend_user_id : f.user_id;
    return fid === friendUserId;
  });
  if (friend) onSendCollabInvite?.(friend);
}}

// AFTER:
onAddToSession={(friendUserId) => {
  setShowFriendsModal(false);
  const friend = dbFriends.find(f => {
    const fid = f.user_id === (user?.id || '') ? f.friend_user_id : f.user_id;
    return fid === friendUserId;
  });
  if (friend) handleAddToBoard(friend);  // existing function at L1985 — opens AddToBoardModal
}}
```

**Edit @ lines 1981-1983 (`handleSendCollabInvite`):** DELETE the function entirely if `onSendCollabInvite` prop is removed (verify via grep first). If kept (caller exists elsewhere), leave untouched.

**Edit @ prop interface (line 76):** remove `onSendCollabInvite?: (friend: any) => void` if §3.4.1 deletion is confirmed by grep.

**Edit @ AddToBoardModal mount site (lines 2228-2237):**

```tsx
// BEFORE:
<AddToBoardModal
  isOpen={showAddToBoardModal}
  onClose={() => {
    setShowAddToBoardModal(false);
    setSelectedFriendForBoard(null);
  }}
  friend={selectedFriendForBoard}
  boardsSessions={boardsSessions}
  onConfirm={handleAddToBoardConfirm}
/>

// AFTER:
<AddToBoardModal
  isOpen={showAddToBoardModal}
  onClose={() => {
    setShowAddToBoardModal(false);
    setSelectedFriendForBoard(null);
  }}
  friend={selectedFriendForBoard}
  boardsSessions={boardsSessions}
  onMutationSettled={refreshBoardsSessions}  // new — passed down from app/index.tsx
/>
```

**Delete:** `handleAddToBoardConfirm` at lines 1990-1994 (no longer called — AddToBoardModal owns the mutation now).

#### 3.4.3 — `app-mobile/src/components/AddToBoardModal.tsx` (RC-3 + CF-2 close)

**Props interface (lines 35-41):**

```tsx
// BEFORE:
interface AddToBoardModalProps {
  isOpen: boolean;
  onClose: () => void;
  friend: Friend | null;
  boardsSessions?: any[];
  onConfirm: (sessionIds: string[], friend: Friend) => void;
}

// AFTER:
interface AddToBoardModalProps {
  isOpen: boolean;
  onClose: () => void;
  friend: Friend | null;
  boardsSessions?: any[];
  onMutationSettled?: () => void;  // refresh trigger
}
```

**Add hook + new handler (replaces lines 75-87):**

```tsx
import { useAddFriendToSessions } from '../hooks/useAddFriendToSessions';
import type { AddFriendsToSessionsReturn } from '../services/sessionMembershipService';

// inside component body, replace the existing handleAddToBoard:
const mutation = useAddFriendToSessions({
  onMutationSettled: onMutationSettled,
});
const [lastResult, setLastResult] = useState<AddFriendsToSessionsReturn | null>(null);

const handleAddToBoard = async () => {
  if (selectedSessions.length === 0 || !friend) return;
  // Build sessionNames map for telemetry payload
  const sessionNames: Record<string, string> = {};
  for (const id of selectedSessions) {
    const s = sessions.find(ss => ss.id === id);
    if (s) sessionNames[id] = s.name;
  }
  const result = await mutation.mutateAsync({
    sessionIds: selectedSessions,
    friendUserId: friend.id,
    sessionNames,
  });
  setLastResult(result);
  setSelectedSessions([]);
  // Close on full success or all-already-state. On any error, keep modal open
  // and render inline error UI.
  if (result.errors.length === 0) {
    onClose();
  }
};
```

**Replace fake spinner state machine** — delete `isAdding` local state; use `mutation.isPending` instead. UX states:

| State | Render |
|---|---|
| `mutation.isPending` | Spinner + "Inviting…" copy. Buttons disabled. |
| Idle (no result yet) | Existing picker UI. |
| `lastResult` populated, all errors empty, all `invited` | Toast (via parent setNotifications, see §3.4.4) + modal closed. |
| `lastResult` populated, some `already_invited`/`already_member` | Inline info banner before close: e.g., "{name} is already in 2 of these. Invited to 1 new session." |
| `lastResult.errors.length > 0` | Inline error UI inside modal: list of session names + per-session error code mapped to friendly copy. Modal stays open; user can dismiss or retry. |

**Pre-flight filter (CF-2 close)** — `availableSessions` filter at lines 153-157 extends from "not a participant + not archived" to also exclude "has pending invite":

```tsx
// BEFORE:
const availableSessions = sessions.filter(session => 
  !session.participants.some(participant => participant.id === friend.id) &&
  session.status !== 'archived'
);

// AFTER:
const availableSessions = sessions.filter(session => {
  const friendIsParticipant = session.participants.some(p => p.id === friend.id);
  const friendHasPendingInvite = (session.pendingInviteeIds ?? []).includes(friend.id);
  const sessionIsValidStatus = session.status === 'active' || session.status === 'pending';
  return !friendIsParticipant && !friendHasPendingInvite && sessionIsValidStatus;
});
```

The `pendingInviteeIds` field is added to the `boardsSessions` shape in §3.4.6.

**Delete:** `// Simulate API call delay` comment + `await new Promise(resolve => setTimeout(resolve, 1000))` line. Delete `isAdding` state and its setter.

#### 3.4.4 — Toast plumbing for AddToBoardModal results

The orchestrator's locked rule: notifications are owned at the AppHandlers / parent level, but `handleAddToBoard` at AppHandlers is being deleted. New rule: **AddToBoardModal owns its own toast emission via the existing `setNotifications` consumer pattern, OR** — more aligned with Constitution #2 — the modal exposes an `onResult(result: AddFriendsToSessionsReturn)` callback and the caller (ConnectionsPage) forwards to the global notifications.

**Spec decision:** modal calls `onResult(result)` callback after mutation settles. ConnectionsPage's `<AddToBoardModal>` mount passes `onResult={(r) => emitAddToBoardToasts(r, friend, sessions)}`. The function `emitAddToBoardToasts` lives in a new `app-mobile/src/utils/addToBoardToasts.ts` helper that builds the right toast(s) per outcome aggregate and calls `setNotifications` (passed in or sourced via a notification context — implementor's call, justify in implementation report).

**Toast aggregation rules** (per investigation §14 Q1 + spec dispatch §1 Layer 5):

| Result mix | Single toast |
|---|---|
| All N invited | "Invited {friendName} to {N} session{s}." (success) |
| K invited + M already_invited (no errors) | "Invited {friendName} to {K} new session{s}. {M} already had pending invites." (info) |
| K invited + M already_member (no errors) | "Invited {friendName} to {K} new session{s}. Already in {M} of the rest." (info) |
| 0 invited + N already_member | "{friendName} is already in all selected sessions." (info) |
| Any blocked outcome | "Can't invite {friendName} to {sessionName}." (neutral, do not reveal block direction) — append to other toasts as separate entry |
| Any session_invalid | "{sessionName} is no longer available." (warning, separate entry) |
| errors.length > 0 | Modal stays open; inline error UI; no toast emitted (user retries from modal) |

#### 3.4.5 — `app-mobile/src/components/AppHandlers.tsx` (RC-2 close)

**Delete @ lines 316-338:** the entire `handleAddToBoard` function.

**Delete @ exported handlers object:** the `handleAddToBoard` entry from the return value.

Pre-flight grep verifies no other consumer of `handlers.handleAddToBoard`. If a stale call site exists, surface in implementation report; do not silently re-route.

#### 3.4.6 — `app-mobile/src/components/AppStateManager.tsx` + `app/index.tsx` (CF-2 + CF-3 mitigation)

**`boardsSessions` shape extension:** add `pendingInviteeIds?: string[]` to each session record.

**Where populated:** in `app/index.tsx:1280-1306` (the existing imperative fetch). After fetching active boards + pending invites, build a per-session lookup of pending-invite invitee IDs and attach.

```typescript
// inside the existing fetchAndMergeBoards / loadBoards function in app/index.tsx,
// after `pendingInvitedSessions` is built:
const pendingByInviter = await supabase
  .from('collaboration_invites')
  .select('session_id, invited_user_id')
  .eq('inviter_id', user.id)
  .eq('status', 'pending');

const pendingMap = new Map<string, string[]>();
(pendingByInviter.data ?? []).forEach(row => {
  const list = pendingMap.get(row.session_id) ?? [];
  list.push(row.invited_user_id);
  pendingMap.set(row.session_id, list);
});

// After dedup:
const enriched = uniqueSessions.map(s => ({
  ...s,
  pendingInviteeIds: pendingMap.get(s.id) ?? [],
}));
updateBoardsSessions(enriched);
```

**Caveat:** this populates `pendingInviteeIds` only for sessions where the *current user is the inviter*. A friend who has been invited by a different participant would NOT be filtered out for the current user. This is acceptable — the RPC's `already_invited` outcome handles the duplicate-add gracefully with a friendly toast. Pre-flight filter is a UX optimization, not a correctness gate.

#### 3.4.7 — `app-mobile/src/components/MessageInterface.tsx` (HF-3 close)

**Edit @ lines 92-98 (props interface):** remove the unused 3rd arg from `onAddToBoard`:

```tsx
// BEFORE:
onAddToBoard?: (
  sessionIds: string[],
  friend: any,
  suppressNotification?: boolean
) => void;

// AFTER (REMOVED — prop signature consolidated):
// (delete this prop entirely if MessageInterface is now wired through the new mutation hook)
```

**Edit @ lines 587-610:** rewrite `handleAddToBoard` and `handleBoardSelection` to use `useAddFriendToSessions` directly OR open AddToBoardModal via a parent-provided opener prop. **Recommended: open AddToBoardModal** (consolidate UX with Friends modal entry). Implementor's call — justify in implementation report.

If implementor chooses direct mutation (no AddToBoardModal in DM path):
- DELETE local toast at lines 604-608 (HF-3 close — consolidate to the mutation result handler).
- Replace BoardSelection's inline toast with the same `emitAddToBoardToasts` helper from §3.4.4.

If implementor chooses AddToBoardModal opener:
- DM more-options "Add to board" tap → `setShowAddToBoardModal(true)` + `setSelectedFriendForBoard(friend)` via parent props.
- DELETE BoardSelection sub-UI at lines 590-600 (subtract before adding).
- DELETE local toast at 604-608.

#### 3.4.8 — `app-mobile/src/services/boardInviteService.ts` (CF-1 zombie)

**Delete:** `static async sendFriendInvites(...)` method at lines 176-204.

**Verify (pre-flight grep):** zero callers of `BoardInviteService.sendFriendInvites` across mobile codebase. Investigation already confirmed zero. If any caller surfaces during implementation, route through `addFriendsToSessions` instead and document in implementation report.

**Keep:** `generateInviteLink`, `getInviteCode`, `joinByInviteCode`, `joinByInviteLink`, `getPendingInvites`, `declineInvite` — these are not zombies (e.g., `generateInviteLink` is called by `useBoardSession.ts:271`).

#### 3.4.9 — `app-mobile/src/services/sessionInviteService.ts` (S-10 refactor)

**Edit @ lines 51-148 (warm path):** delegate to `addFriendsToSessions`:

```typescript
// BEFORE (lines 51-148, warm path body):
// (existing 90-line direct-insert + push-invoke logic)

// AFTER:
if (lookupResult.found && lookupResult.user) {
  const invitedUserId = lookupResult.user.id;

  if (invitedUserId === inviterUserId) {
    return { kind: 'error', message: 'You cannot invite yourself' };
  }

  // Delegate to the canonical service.
  const { results, errors } = await addFriendsToSessions({
    sessionIds: [sessionId],
    friendUserId: invitedUserId,
    sessionNames: { [sessionId]: sessionName },
  });

  if (errors.length > 0) {
    return { kind: 'error', message: errors[0].message };
  }

  const result = results[0];
  if (result.outcome === 'invited') {
    const displayName =
      lookupResult.user.display_name ||
      [lookupResult.user.first_name, lookupResult.user.last_name].filter(Boolean).join(' ') ||
      lookupResult.user.username || null;
    return { kind: 'warm', userId: invitedUserId, displayName };
  }
  if (result.outcome === 'already_member') {
    return { kind: 'error', message: 'This user is already in the session' };
  }
  if (result.outcome === 'already_invited') {
    // Treat as warm — a pending invite is already on its way.
    const displayName = /* same resolution as above */;
    return { kind: 'warm', userId: invitedUserId, displayName };
  }
  if (result.outcome === 'blocked') {
    return { kind: 'error', message: 'Cannot invite this user.' };
  }
  return { kind: 'error', message: 'Could not send invite.' };
}
// (cold path UNCHANGED — lines 150-167)
```

#### 3.4.10 — `app-mobile/src/components/board/InlineInviteFriendsList.tsx` (S-10 refactor)

**Edit @ lines 137-247 (`handleSendInvites`):** replace inline insert+push triplet with `addFriendsToSessions` call. Keep multi-friend loop ergonomics (one friend × N=1 session per call). Map outcomes to existing Alert UI.

```typescript
const handleSendInvites = useCallback(async (): Promise<void> => {
  if (!user?.id || !sessionId || selectedFriends.length === 0) return;
  setSending(true);
  try {
    let successCount = 0;
    for (const friend of selectedFriends) {
      const { results } = await addFriendsToSessions({
        sessionIds: [sessionId],
        friendUserId: friend.id,
        sessionNames: { [sessionId]: sessionName },
      });
      if (results[0]?.outcome === 'invited') successCount++;
    }
    if (successCount > 0) {
      // Existing telemetry is now emitted by addFriendsToSessions; remove inline emission to avoid double-fire.
      Alert.alert(
        t('board:inlineInviteFriendsList.invitesSent'),
        t('board:inlineInviteFriendsList.invitesSentMsg', {
          count: successCount,
          plural: successCount > 1 ? 's' : '',
          name: sessionName,
        })
      );
      setSelectedFriends([]);
      onInvitesSent?.();
    } else {
      Alert.alert(
        t('board:inlineInviteFriendsList.error'),
        t('board:inlineInviteFriendsList.errorSendInvites')
      );
    }
  } catch (err) {
    console.error('[InlineInviteFriendsList] Error sending invites:', err);
    Alert.alert(
      t('board:inlineInviteFriendsList.error'),
      t('board:inlineInviteFriendsList.errorSendInvites')
    );
  } finally {
    setSending(false);
  }
}, [user?.id, sessionId, sessionName, selectedFriends, onInvitesSent, t]);
```

DELETE inline `mixpanelService.trackCollaborationInvitesSent` and `logAppsFlyerEvent` calls — telemetry now lives single-owner inside `sessionMembershipService`.

---

### 3.5 — Realtime layer

**No changes.** Verified in investigation:
- `collaboration_invites` is in `supabase_realtime` publication (migration `20260312400002`).
- Invitee's other devices receive postgres_changes INSERT broadcast → existing in-app surfaces (NotificationsModal, CollaborationModule Invites tab) update live.
- Existing members do NOT receive a broadcast on invite-create (intentional — privacy + low value, locked in dispatch §1 Layer 6).
- `notifyMemberJoined` already wired in `acceptCollaborationInvite` Step 4 — broadcasts to existing members on accept. Already works.

---

### 3.6 — Edge function layer

**No changes.** `send-collaboration-invite` (push-only) is invoked by `sessionMembershipService` per `invited` outcome. Existing JWT validation accepts `inviter_id === auth.uid()` (verified — index.ts:80-88). Push delivery, mute / quiet hours, OneSignal already correct.

---

### 3.7 — Telemetry layer

| Event | Provider | Source | Trigger |
|---|---|---|---|
| `collaboration_invites_sent` | Mixpanel | `sessionMembershipService.addFriendsToSessions` | Once per call when `successCount > 0` |
| `collaboration_invite_sent` | AppsFlyer | same | same |

**Payload schemas:**

```typescript
// Mixpanel
{
  sessionId: string;     // comma-joined for multi-session calls
  sessionName: string;   // 'multi' if multiple
  invitedCount: number;  // total sessions attempted
  successCount: number;  // outcomes === 'invited'
}

// AppsFlyer
{
  session_count: number;
  success_count: number;
  invitee_id: string;
}
```

DELETE inline emissions from `InlineInviteFriendsList.handleSendInvites` (refactored to delegate); single-owner telemetry per Constitution #2.

---

## 4 — Success criteria

| ID | Criterion | Layer |
|---|---|---|
| SC-1 | Tap "Add to session" on Friends modal → AddToBoardModal opens with chosen friend pre-set. | Component |
| SC-2 | Tap "Add to board" in DM more-options → AddToBoardModal opens with chosen friend pre-set (or BoardSelection — implementor's call, both consolidate downstream). | Component |
| SC-3 | Single-session confirm creates exactly one `collaboration_invites (status='pending', invite_method='friends_list')` AND one `session_participants (has_accepted=false)` atomically. | DB + Service |
| SC-4 | N-session confirm creates exactly N invite + N participant rows. | DB + Service |
| SC-5 | Invitee receives push within 10s of confirm (verified via OneSignal dashboard or device receipt). | Edge fn + push |
| SC-6 | Invitee can accept via NotificationsModal → full `acceptCollaborationInvite` pipeline runs (board create on 2nd accept, prefs JSONB merge, member-joined notify) — identical to today's flow. | Service + DB |
| SC-7 | Re-add friend with pending invite → 0 new rows; `outcome='already_invited'`; "already invited" toast shown. | DB UNIQUE + RPC + UX |
| SC-8 | Re-add friend who is already an accepted member → 0 row mutation; `outcome='already_member'`; "already in session" toast. | DB + RPC + UX |
| SC-9 | Add friend who blocks inviter (or vice versa) → 0 rows; `outcome='blocked'`; neutral toast that does NOT reveal block direction. | DB + RPC |
| SC-10 | Add to session in status `archived`/`ended`/`cancelled` → 0 rows; `outcome='session_invalid'` with `error_code` carrying the offending status. | DB + RPC + UX |
| SC-11 | RPC called by non-session-member of `p_session_id` → `outcome='not_session_member'` (defensive — should be impossible from UI). | DB + RPC |
| SC-12 | No `setTimeout` placeholder remains in `AddToBoardModal.tsx`. Verified by grep. | Static |
| SC-13 | No `console.log("Sending collaboration invite to:")` remains in `app/index.tsx`. Verified by grep. | Static |
| SC-14 | Zero callers of `BoardInviteService.sendFriendInvites` remain; method DELETED. Verified by grep. | Static |
| SC-15 | DM-path produces exactly ONE success toast (not two). HF-3 close. | Component + UX |
| SC-16 | Pre-flight filter excludes already-pending invitees from AddToBoardModal session list (within current user's invitations only — see §3.4.6 caveat). | Component + Service |
| SC-17 | After every successful add, `refreshBoardsSessions()` fires; pending invitee is filtered out on next render. CF-3 mitigation. | Hook + State |
| SC-18 | Mixpanel `collaboration_invites_sent` and AppsFlyer `collaboration_invite_sent` fire with correct payload (verified via dashboard/local capture). | Telemetry |
| SC-19 | RPC `add_friend_to_session(uuid, uuid)` callable by `authenticated` role; not by `anon`. Verified via `has_function_privilege` probe. | DB |
| SC-20 | Migration applies cleanly on `supabase db reset`; `\df add_friend_to_session` shows correct signature + SECURITY DEFINER + GRANT. | DB |
| SC-21 | Self-invite refused by RPC (`outcome='session_creator_self_invite'`). Defensive — UI already prevents but RPC enforces. | DB + RPC |
| SC-22 | Concurrent two-client add-same-friend-to-same-session race → exactly one `invited` outcome + one `already_invited`; no orphan participant. | DB concurrency |
| SC-23 | Telemetry single-owner: only `sessionMembershipService` emits `collaboration_invites_sent`. Verified by grep across `app-mobile/src/`. | Static |
| SC-24 | Re-pending after decline: friend who previously declined is re-invited → existing row UPDATEs to `status='pending'`; outcome `'invited'`; new push fires. | DB + RPC |
| SC-25 | Bundle size delta: net LOC change is negative (subtract before adding). Implementor reports `git diff --stat` summary. | Static |

---

## 5 — Invariants

### Preserved

| ID | Invariant | How preserved |
|---|---|---|
| I-COLLAB-INVITE-IDEMPOTENT | UNIQUE `(session_id, invited_user_id)` on `collaboration_invites` | RPC uses `ON CONFLICT DO NOTHING` + falls through to `already_invited` outcome |
| I-PARTICIPANT-IDEMPOTENT | UNIQUE `(session_id, user_id)` on `session_participants` | RPC uses `ON CONFLICT DO NOTHING`; never demotes accepted to false |
| I-RPC-AUTH-CHECK | Every SECURITY DEFINER RPC validates `auth.uid()` | RPC Guard 1 returns `not_session_member`/`unauthenticated` if missing |
| I-PUSH-MUTE-RESPECT | `notify-dispatch` honors mute/quiet-hours/preferences | Spec uses existing edge fn; no bypass |
| Constitution #1, #2, #3, #7, #8, #9 | Per investigation §11 | Spec restores all 6 |

### NEW — established by this spec

| ID | Invariant | Enforcement |
|---|---|---|
| **I-INVITE-CREATION-IS-RPC-ONLY** | Direct INSERTs into `collaboration_invites` from mobile code are prohibited. All creation goes through `add_friend_to_session` RPC (or phone-cold-path's `pending_session_invites` write). | CI grep gate (see §8): post-merge, `from('collaboration_invites').insert(` should match zero non-test files. |
| **I-NO-FAKE-API-DELAY** | No `setTimeout`/`new Promise(r => setTimeout(r, ...))` simulating an API call may exist in component files. | CI grep gate (see §8). |

---

## 6 — Test cases

| ID | Scenario | Inputs | Expected | Layers |
|---|---|---|---|---|
| T-01 | Happy path single-session | Friend A, session S (active, caller is member) | 1 invite row pending; 1 participant row has_accepted=false; push sent; success toast | DB + Service + Hook + Component + Edge |
| T-02 | Happy path multi-session | Friend A, sessions [S1, S2, S3] | 3 invite + 3 participant rows; 3 pushes; aggregate toast "Invited A to 3 sessions" | DB + Service + UX |
| T-03 | Idempotent re-invite (pending) | Friend A, session S where A already has pending invite | 0 new rows; `outcome='already_invited'`; "already invited" toast | DB UNIQUE + RPC + UX |
| T-04 | Idempotent re-invite (accepted) | Friend A, session S where A is accepted member | 0 row mutation; `outcome='already_member'`; "already in session" toast | DB + UX |
| T-05 | Block-check inviter→invitee | Friend A blocked by inviter | 0 rows; `outcome='blocked'`; neutral toast | DB + RPC |
| T-06 | Block-check invitee→inviter | Friend A has inviter blocked | 0 rows; `outcome='blocked'`; neutral toast | DB + RPC |
| T-07 | Archived session | Session S has status='archived' | 0 rows; `outcome='session_invalid'`; `error_code='session_status_archived'`; warning toast | DB + RPC |
| T-08 | Non-member inviter | RPC called by user not in `session_participants` for p_session_id | 0 rows; `outcome='not_session_member'`; error toast | DB + RPC |
| T-09 | Concurrent inserts (race) | Two clients simultaneously add same friend to same session | DB UNIQUE serializes; one wins (`invited`), one gets `already_invited`; no orphan participant | DB + Concurrency |
| T-10 | Push delivery failure | OneSignal returns 500 for `send-collaboration-invite` | Invite + participant rows persist; success toast still shown (push non-fatal); error logged | Edge + Service |
| T-11 | RPC permission test | `anon` role calls RPC | Permission denied at the function level (REVOKE PUBLIC) | DB + RPC |
| T-12 | Friends modal entry | Tap "Add to session" sheet item | AddToBoardModal opens with friend pre-set | Component |
| T-13 | DM-path entry | Tap "Add to board" in DM more-options | AddToBoardModal opens (or BoardSelection — see §3.4.7) with friend pre-set | Component |
| T-14 | Single-toast on DM path | Multi-board confirm via DM path | Exactly one toast surfaced (HF-3) | Component |
| T-15 | Pending-invitee pre-flight filter | Friend A has pending invite to S; open AddToBoardModal for A from caller-as-inviter | Session S NOT in available list | Component + State |
| T-16 | Stale boardsSessions FK violation | Open AddToBoardModal with stale state where S was just deleted | RPC returns `session_invalid` with `error_code='session_not_found'`; warning toast; modal stays open | DB + UX |
| T-17 | Zombie deletion verification | grep `BoardInviteService.sendFriendInvites` and `sendFriendInvites(` post-merge | Zero matches in mobile codebase | Static |
| T-18 | Acceptance flow regression | Invitee accepts the new pending invite | acceptCollaborationInvite full pipeline runs (board create, prefs seed, member-joined notify) — identical to today | Service + DB + Realtime |
| T-19 | Constitutional #1 — every interactive element responds | Manual: tap "Add to session" + "Add to board" + "Confirm" | Each produces real UX feedback (modal open, spinner, toast) | UX |
| T-20 | Constitutional #9 — no fabricated counts | Multi-result run with mix of invited + already_invited | Toast counts match actual DB rows | UX + DB |
| T-21 | Self-invite | RPC called with `p_friend_user_id = auth.uid()` | `outcome='session_creator_self_invite'`; UI guard at picker level prevents but RPC enforces | DB + RPC |
| T-22 | Re-pending after decline | Friend A previously declined invite to S; user re-adds A | Existing invite row status: 'declined' → 'pending'; new push fires; participant row re-set has_accepted=false | DB + RPC |
| T-23 | Telemetry payload integrity | Single + multi-session calls capture Mixpanel + AppsFlyer events | Payload matches §3.7 schemas exactly | Telemetry |
| T-24 | Telemetry single-owner | grep `trackCollaborationInvitesSent` post-merge | Only `sessionMembershipService.ts` matches | Static |
| T-25 | I-INVITE-CREATION-IS-RPC-ONLY enforcement | grep `from('collaboration_invites').insert(` post-merge | Zero matches in `app-mobile/src/` non-test files | Static |
| T-26 | I-NO-FAKE-API-DELAY enforcement | grep `Simulate API call delay` and `await new Promise(resolve => setTimeout(resolve` in component files | Zero matches in non-test files | Static |
| T-27 | Friend deletes account mid-add (data integrity) | Friend deletes during invite-create | `handle_user_deletion_cleanup` trigger removes the invite row; no orphan | DB + Trigger |
| T-28 | Mute parity | Friend has muted notifications from inviter | Invite row created (DB-layer), but push suppressed by `notify-dispatch` mute filter | Edge + DB |
| T-29 | Capacity (informational, no enforcement in v1) | `collaboration_sessions.max_participants = 5`, session has 5 accepted | RPC succeeds (no capacity check at invite time); friend will hit capacity at acceptance time IF a separate trigger exists. Spec: confirm no spec-level capacity check needed; orchestrator accepts current behavior. | DB |
| T-30 | OTA-eligible — no native changes | `eas update --branch production` ships fix without native rebuild | Bundle delta confirmed in implementor report | Build |

---

## 7 — Implementation order

1. **Database** — apply migration `20260427000002_orch_0666_add_friend_to_session_rpc.sql` (Probes 1, 2 verify deployment; Probes 3, 4 verify happy path + idempotency).
2. **Service** — create `app-mobile/src/services/sessionMembershipService.ts`.
3. **Hook** — create `app-mobile/src/hooks/useAddFriendToSessions.ts`.
4. **State plumbing** — extend `app/index.tsx:1280-1306` to populate `pendingInviteeIds` per session; export `refreshBoardsSessions` callable.
5. **Toast helper** — create `app-mobile/src/utils/addToBoardToasts.ts` with `emitAddToBoardToasts(result, friend, sessions, setNotifications)`.
6. **AddToBoardModal** — replace `setTimeout` + `isAdding` with mutation hook; add filter for `pendingInviteeIds`; add result-state UX.
7. **ConnectionsPage** — rewire `onAddToSession` to `handleAddToBoard(friend)`; remove `handleAddToBoardConfirm`; update `<AddToBoardModal>` mount.
8. **app/index.tsx** — delete two `console.log` `onSendCollabInvite` fakes; remove the prop from `<ConnectionsPage>` mounts.
9. **AppHandlers** — delete `handleAddToBoard`; remove from exported handlers object.
10. **MessageInterface** — choose modal-opener path (recommended) OR direct-mutation path; delete local toast L604-608; align `onAddToBoard` signature.
11. **Refactor InlineInviteFriendsList** — delegate to `addFriendsToSessions`; remove inline telemetry emissions.
12. **Refactor sessionInviteService.inviteByPhone warm path** — delegate to `addFriendsToSessions`.
13. **Delete BoardInviteService.sendFriendInvites** — pre-flight grep zero callers; delete method.
14. **CI gates** — add the two grep gates to `scripts/ci-check-invariants.sh` (or equivalent):
    - `! grep -rn "from('collaboration_invites').insert(" app-mobile/src/ --include='*.ts' --include='*.tsx' --exclude='*.test.*' --exclude='*.spec.*' --exclude='sessionMembershipService.ts'` (negative-control: should grep zero post-merge except service is allowed if the spec routes inserts through the RPC; if spec routes inserts only through RPC, the service file also matches zero)
    - `! grep -rn "Simulate API call delay" app-mobile/src/ --include='*.ts' --include='*.tsx' --exclude='*.test.*'`
15. **Negative-control reproduction** — implementor injects a temporary direct INSERT into `collaboration_invites` in a comment-only-stripped test branch, runs CI, confirms the gate fires, removes the injection.
16. **i18n keys (English only)** — add to `app-mobile/src/i18n/locales/en/common.json` (or `modals.json`):
    - `toast_invite_sent_single` — "Invited {name} to {sessionName}."
    - `toast_invite_sent_multi` — "Invited {name} to {count} sessions."
    - `toast_invite_already_invited_single` — "{name} already has a pending invite to {sessionName}."
    - `toast_invite_already_invited_multi` — "Invited {name} to {newCount} new sessions; already invited to {existingCount}."
    - `toast_invite_already_member_single` — "{name} is already in {sessionName}."
    - `toast_invite_already_member_multi` — "{name} is already in {count} of these sessions."
    - `toast_invite_blocked` — "Can't invite {name}."
    - `toast_invite_session_invalid` — "{sessionName} is no longer available."
    - `toast_invite_error` — "Couldn't send invite. Tap to retry."
    - Multi-locale sweep: file follow-up ORCH for the 27 other languages.

**Total file delta (estimated):**
- 1 new migration
- 3 new files (service, hook, toast helper)
- ~12 edited files
- Net LOC: -50 to -100 (subtract before adding — zombie + 4 fakes + duplicated logic compress into one service + RPC)

---

## 8 — Regression prevention

### Structural safeguards

1. **CI grep gates** (per §7 step 14) — enforce the two new invariants at PR-merge time. Negative-control reproduction (§7 step 15) proves the gates work.
2. **Telemetry single-owner** — `mixpanelService.trackCollaborationInvitesSent` callable count = 1 (only inside `sessionMembershipService`). CI grep for the function name; expect 2 matches (definition + service).
3. **Type narrowing** — RPC return shape is typed in service layer; outcome enum is exhaustive switch in toast helper. TypeScript compiler catches missing cases.

### Protective comments

Prepend `add_friend_to_session` migration with the `[ORCH-0666]` block already shown. Prepend `sessionMembershipService.ts` with the contract docblock. Prepend `addToBoardToasts.ts` with a similar contract block. **Do NOT** prepend ConnectionsPage / AppHandlers / AddToBoardModal — those are large multi-purpose files; the comments would rot.

### Process discoveries (per investigation §15)

- ORCH-0666.D-4 (placeholder shipped 7 weeks): non-enforceable rule — flag in code review that `console.log`-only and `setTimeout`-only handlers in component files should carry `// ORCH-XXXX TEMPORARY — exit-when: <condition>` per Constitution #7.

---

## 9 — Open question resolutions (from spec dispatch §2)

| Q | Resolution | Rationale |
|---|---|---|
| Q1 multi-session ergonomics | **ADOPTED** investigation rec — serial loop + single end-state aggregate toast | Predictable error UX; small N (1-5); matches existing InlineInviteFriendsList pattern |
| Q2 re-pending after decline | **ADOPTED** — UPDATE existing row to status='pending', re-attribute inviter_id | Friendship is consent-positive; friend can decline again; preserves UNIQUE constraint |
| Q3 inviter-revoke UX | **DEFERRED** | Out of ORCH-0666 scope; orchestrator may file as separate ORCH if user requests |
| Q4 pre-flight pending-invitee filter | **ADOPTED** investigation rec — extend `boardsSessions` shape with `pendingInviteeIds` | Caller-scoped only (current user's invitations); RPC's `already_invited` handles cross-user cases |
| Q5 atomic insert via RPC | **LOCKED §0** — implemented as single RPC | Server-authoritative, RLS-friendly, single round-trip |
| Q6 HF-1 RLS hardening | **LOCKED OUT-OF-SCOPE** → ORCH-0672 | RLS changes are higher-risk than application-layer wiring |
| Q7 zombie sendFriendInvites disposition | **DELETE** | Subtract before adding |
| Q8 MessageInterface DM path | **KEEP**, route through new service | Consolidates Constitution #2 across 3 entry points |
| Q9 telemetry events | **PRESERVED** — same event names, payload schema documented in §3.7 | No analytics regression |
| Q10 i18n batching | English-first, multi-locale sweep deferred | Keeps PR reviewable; locale sweep is mechanical follow-up |

---

## 10 — Cross-references to investigation findings

| Finding | Addressed in spec section |
|---|---|
| RC-1 (`onSendCollabInvite` console.log) | §3.4.1 + §3.4.2 |
| RC-2 (AppHandlers toast-only) | §3.4.5 |
| RC-3 (AddToBoardModal setTimeout) | §3.4.3 + §5 invariant I-NO-FAKE-API-DELAY |
| CF-1 (BoardInviteService zombie) | §3.4.8 |
| CF-2 (idempotency gap) | §3.4.3 + §3.4.6 + §3.1 RPC idempotency |
| CF-3 (boardsSessions dual-source) | §3.3 mitigation via refreshBoardsSessions |
| HF-1 (RLS gap) | OUT-OF-SCOPE → ORCH-0672 |
| HF-2 (orphan participant) | §3.1 atomic RPC closes |
| HF-3 (3rd-arg silently dropped) | §3.4.7 signature alignment + L604-608 deletion |
| HF-4 (block-check missing) | §3.1 Guard 5 + T-05 + T-06 |
| HF-5 (wrong primitive at L2701-2709) | §3.4.2 rewires to handleAddToBoard |
| OBS-1..OBS-5 | Leveraged in spec architecture (canonical reference, push-only edge fn, UNIQUE constraint, notifyMemberJoined, never-implemented framing) |

---

## 11 — Spec self-check (orchestrator REVIEW gates pre-emptively addressed)

- ✅ Every layer specified (DB, Service, Hook, Component × 8, Realtime confirmed N/A, Edge confirmed N/A, Telemetry).
- ✅ Each SC observable + testable + unambiguous.
- ✅ Migration body fully copy-pastable, has GRANT, has SET search_path, has REVOKE PUBLIC, has SECURITY DEFINER, has COMMENT.
- ✅ Every T-XX has Expected outcome grounded in DB or RPC truth.
- ✅ §0 locked decisions respected; no amendment block needed.
- ✅ HF-1 confirmed out-of-scope; ORCH-0672 referenced.
- ✅ Subtract-before-add list complete (7 deletions: zombie, 2 console.logs, setTimeout, comment, AppHandlers stub, MessageInterface local toast, inline telemetry × 2 callsites).
- ✅ 13 required spec sections present (§1-§11 plus implicit §0 in dispatch reference).

---

## 12 — Dispatch instruction (for orchestrator)

This spec is binding. Implementor MUST execute steps 1-16 in order. Tester MUST verify all 30 test cases. If any T-XX fails, RETEST per orchestrator's RETEST_LEDGER protocol.

If implementor surfaces ambiguity DURING execution that this spec did not anticipate, they must HALT and surface to the orchestrator — do NOT silently make a design call.

---

**Spec confidence: HIGH.** All findings six-field-proven in investigation; spec is deterministic given §0 locked decisions and existing infrastructure. No re-investigation required. Ready for IMPLEMENTOR dispatch.

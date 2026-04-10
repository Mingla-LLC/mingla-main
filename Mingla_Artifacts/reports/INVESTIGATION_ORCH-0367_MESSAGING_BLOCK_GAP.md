# Investigation Report: ORCH-0367 — Stale Block Prevents Messaging Between Friends

> Confidence: **HIGH** — all layers verified, root cause proven with six-field evidence
> Date: 2026-04-10
> Investigator: Forensics

---

## Executive Summary

When a user blocks someone then later re-friends them via a new friend request, the block record in `blocked_users` is never cleaned up. The `accept_friend_request_atomic` RPC function creates the friendship without checking or clearing existing blocks. This leaves the system in a contradictory state: `friends` says accepted, `blocked_users` says blocked, and messaging is silently broken. Only 1 user pair is currently affected (Seth ↔ Arifat), but any block→re-friend sequence will reproduce this.

---

## Investigation Manifest

| # | File | Layer | Purpose |
|---|------|-------|---------|
| 1 | `supabase/migrations/20250204000001_create_blocked_users.sql` | Schema | Block system: tables, triggers, RLS, helper functions |
| 2 | `supabase/migrations/20260314000008_extend_friend_accept_rpc_with_pair_requests.sql` | Schema | The active `accept_friend_request_atomic` RPC |
| 3 | `app-mobile/src/services/blockService.ts` | Code | Block/unblock client-side logic |
| 4 | `app-mobile/src/services/friendsService.ts` | Code | Friend queries (no acceptance logic here) |
| 5 | `app-mobile/src/services/messagingService.ts` | Code | Messaging gates (block → friendship → conversation) |
| 6 | `app-mobile/src/services/connectionsService.ts` | Code | Dead acceptance path (line 231) |
| 7 | `app-mobile/src/hooks/useFriends.ts` | Code | Active acceptance flow calling the atomic RPC |
| 8 | `supabase/migrations/20260409800000_add_block_check_to_messages_rls.sql` | Schema | ORCH-0357 RLS fix (block check on message INSERT) |
| 9 | Database queries | Data | Scale assessment + relationship audit |

---

## Findings

### 🔴 Root Cause: `accept_friend_request_atomic` has no block check or cleanup

| Field | Evidence |
|-------|----------|
| **File + line** | `supabase/migrations/20260314000008_extend_friend_accept_rpc_with_pair_requests.sql:19-58` |
| **Exact code** | The function fetches the request (line 20-22), validates receiver identity (line 33), updates status (line 46), creates bidirectional friendship (lines 50-58). **Zero references to `blocked_users` table.** |
| **What it does** | Accepts a friend request and creates friendship regardless of whether a block exists between the two users. |
| **What it should do** | Before creating the friendship: (1) check `blocked_users` for any record between sender and receiver, (2) if a block exists from the RECEIVER (the one accepting), delete it (implicit unblock by accepting), (3) if a block exists from the SENDER, reject the acceptance ("This user is not available"). |
| **Causal chain** | Seth blocks Arifat → `on_user_blocked` trigger deletes `friends` rows but NOT `friend_requests` → stale request `2f9ecebe` survives → Arifat taps Accept → `accept_friend_request_atomic` creates new `friends` rows without touching `blocked_users` → `has_block_between()` still returns true → `messagingService.getOrCreateDirectConversation` line 50-52 returns "Cannot message this user" |
| **Verification step** | Query: `SELECT * FROM blocked_users WHERE blocker_id = '24f48f75...' AND blocked_id = '07abe817...'` returns 1 row. Query: `SELECT * FROM friends WHERE user_id = '24f48f75...' AND friend_user_id = '07abe817...' AND status = 'accepted'` also returns 1 row. Both exist simultaneously. |

### 🟠 Contributing Factor #1: `on_user_blocked` trigger doesn't clean `friend_requests`

| Field | Evidence |
|-------|----------|
| **File + line** | `supabase/migrations/20250204000001_create_blocked_users.sql:81-94` |
| **Exact code** | `handle_user_blocked()` only runs `DELETE FROM friends WHERE ...`. No mention of `friend_requests`. |
| **What it does** | Deletes friendship rows when a block is created, but leaves pending friend requests intact. |
| **What it should do** | Also cancel any pending `friend_requests` between the two users (`UPDATE friend_requests SET status = 'cancelled' WHERE ...`). |
| **Causal chain** | Seth sent friend request `2f9ecebe` at 06:02, then blocked Arifat at 06:03. The block deleted the friendship but left the request pending. Arifat could still accept it 15 hours later. |
| **Verification step** | `friend_requests` id `2f9ecebe` has `status = 'accepted'` and `created_at = 06:02:07`, which is BEFORE the block at 06:03:37. |

### 🟠 Contributing Factor #2: `unblockUser()` only deletes where `blocker_id = current_user`

| Field | Evidence |
|-------|----------|
| **File + line** | `app-mobile/src/services/blockService.ts:87-91` |
| **Exact code** | `.delete().eq("blocker_id", user.id).eq("blocked_id", userId)` |
| **What it does** | Only the user who created the block can remove it. The blocked user has no way to clear it, even by accepting a friend request. |
| **What it should do** | This is correct behavior for the unblock flow itself. But it means the ONLY path to clearing a block is the explicit unblock action. The friend acceptance path MUST also clear it (since accepting a friend request from someone you blocked is an implicit unblock). |

### 🟡 Hidden Flaw #1: Dead acceptance path in `connectionsService.ts`

| Field | Evidence |
|-------|----------|
| **File + line** | `app-mobile/src/services/connectionsService.ts:231-248` |
| **Exact code** | `acceptFriendRequest(requestId)` updates `friends` table directly with `supabase.from('friends').update({ status: 'accepted' }).eq('id', requestId)` |
| **Impact** | This is NOT the active path (the app uses the atomic RPC via `useFriends.ts:264`), but if anyone ever calls `connectionsService.acceptFriendRequest()`, it would bypass all atomic guarantees AND have no block check. |
| **Recommendation** | Delete this dead code or redirect it to the atomic RPC. |

### 🟡 Hidden Flaw #2: No DB-level mutual exclusion constraint

| Field | Evidence |
|-------|----------|
| **Schema check** | No trigger, constraint, or exclusion prevents `friends(status=accepted)` and `blocked_users` from coexisting for the same user pair. PostgreSQL allows both simultaneously. |
| **Impact** | Any future code path that creates friendships without checking blocks will silently produce contradictory state. |
| **Recommendation** | Add a DB trigger on `friends` INSERT/UPDATE that deletes `blocked_users` for the pair, OR add a check in `accept_friend_request_atomic` (preferred — single point of enforcement). |

### 🔵 Observation: ORCH-0357 fix is NOT bypassed — it's working correctly

The ORCH-0357 fix (RLS block check on message INSERT, `20260409800000`) is functioning as designed. The RLS policy correctly prevents message sends when `blocked_users` contains a record. The problem is that `blocked_users` SHOULD NOT contain a record for active friends — it's stale data, not a policy bug.

---

## Five-Layer Cross-Check

| Layer | What It Says | Contradiction? |
|-------|-------------|----------------|
| **Docs** | Block and friendship should be mutually exclusive (implied by ORCH-0356/0357 design) | — |
| **Schema** | `on_user_blocked` trigger deletes friends on block. But no reverse trigger exists. `accept_friend_request_atomic` has no block check. | **YES — schema allows contradictory state** |
| **Code** | `messagingService.ts:50` checks `hasBlockBetween()` before allowing messaging. `blockService.unblockUser()` only works for the blocker. | Correct behavior given the data — but the data is wrong |
| **Runtime** | `has_block_between()` returns TRUE for Seth ↔ Arifat. Messaging returns "Cannot message this user". | Correct given stale block record |
| **Data** | `friends`: accepted (both directions). `blocked_users`: Seth → Arifat. Both tables have records for the same pair. | **YES — contradictory state** |

**Contradiction**: Schema and Data layers disagree. Schema implies mutual exclusion via `on_user_blocked` trigger, but doesn't enforce the reverse. Data shows the contradiction materialized.

---

## Blast Radius

| Surface | Impact |
|---------|--------|
| **Direct Messaging** | Blocked — "Cannot message this user" (service gate + RLS gate) |
| **Connections UI** | Shows as friends (friendship is valid) — misleading |
| **Blocked list UI** | May show Arifat in Seth's blocked list AND friends list simultaneously |
| **Friend requests** | New requests between them would be confusing (already friends + blocked) |
| **Message RLS** | INSERT blocked by ORCH-0357 policy — correct given the data |
| **Profile visibility** | Arifat's profile hidden from Seth via `is_blocked_by` RLS on profiles |

---

## Scale Assessment

**Only 1 user pair affected** (Seth ↔ Arifat). The contradictory state query returned 2 rows (one per friendship direction), both pointing to the same block record.

However, this is a **time bomb**: any user who blocks then re-friends will hit this. The trigger conditions are:
1. User A sends friend request to User B
2. User A blocks User B (trigger deletes friendship but NOT the pending request)
3. User B later accepts the original request

Step 2→3 gap enables re-entry.

---

## Invariant Violations

- **INV-BLOCK-001 (new)**: `blocked_users` and `friends(status=accepted)` MUST be mutually exclusive for any user pair. If a friendship is created, any block between the pair must be cleared. If a block is created, any friendship must be destroyed (this part already works via `on_user_blocked`).

---

## Fix Strategy (direction only — not code)

**Priority order:**

1. **Immediate data fix**: Delete the stale block record for Seth ↔ Arifat
   ```sql
   DELETE FROM blocked_users WHERE blocker_id = '24f48f75-ed2b-4a74-b1ef-84c16fa3c764' AND blocked_id = '07abe817-e4a8-4321-8462-6bea86108ac4';
   ```

2. **Fix `accept_friend_request_atomic`** (root cause): Add block cleanup inside the RPC function. When a friendship is accepted, delete any `blocked_users` rows for that pair. This is the single enforcement point.

3. **Fix `on_user_blocked` trigger** (contributing factor): When a block is created, also cancel any pending `friend_requests` between the pair (`SET status = 'cancelled'`).

4. **Delete dead code** in `connectionsService.ts:231-248`: Remove the non-atomic acceptance path.

5. **Optional — DB constraint**: Add a trigger on `friends` INSERT that auto-deletes `blocked_users` for the pair. Belt-and-suspenders with fix #2.

---

## Regression Prevention

- The atomic RPC is the single acceptance path. As long as it clears blocks, no new contradictory state can form.
- The `on_user_blocked` trigger fix prevents stale friend requests from surviving blocks.
- Together, these close both directions of the block↔friend lifecycle.

---

## Discoveries for Orchestrator

- `connectionsService.ts:231-248` contains a dead `acceptFriendRequest` method that bypasses the atomic RPC. Should be removed to prevent future misuse.
- The `fetchFriendRequests` function in `friendsService.ts` does not filter out requests from blocked users. A blocked user's pending request would appear in the incoming requests list.

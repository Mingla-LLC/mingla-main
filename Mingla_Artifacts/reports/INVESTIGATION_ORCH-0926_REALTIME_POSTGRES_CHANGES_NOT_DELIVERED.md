# INVESTIGATION ORCH-0926: Realtime `postgres_changes` Not Delivered For `collaboration_sessions` UPDATE

## Verdict

**Status:** Root cause identified.  
**Confidence:** High for the delivery mechanics and recommended repair; medium-high for the exact runtime timing edge because raw websocket frames were not captured.  
**Scope:** Investigation only. No product code changed. No mutation was made to live session `daadd454-35a8-487d-ab25-bb595abc4635`.

`collaboration_sessions` UPDATE events are not reaching the React Native board-session client because the failing `board_session:{sessionId}` channel is not deterministically registered with the participant's authenticated JWT at the moment its Postgres-change bindings are joined/rejoined on the Realtime server.

`SUBSCRIBED` is therefore a false comfort signal here. It proves the Phoenix channel joined, but delivery of `postgres_changes` rows is separately gated by Realtime's stored subscription claims and the table's SELECT RLS. If the server-side subscription was registered with anon/stale claims, `realtime.apply_rls` filters the row out before it reaches the client, even though:

- the channel reports `SUBSCRIBED`;
- broadcast events on the same websocket can still work;
- the user can SELECT the row when queried with the correct authenticated claims;
- the table is in the `supabase_realtime` publication;
- the database trigger correctly bumps `deck_version`.

The single recommended fix is to make RLS-gated Postgres-change channels auth-gated and channel-rebound: before creating `board_session:{sessionId}`, await a current Supabase auth session, await `supabase.realtime.setAuth(session.access_token)`, then create/join that specific channel so its join payload includes the authenticated token. On token refresh/sign-in changes, remove and recreate only affected RLS-gated Postgres-change channels, starting with `board_session:{sessionId}`.

Do not use the `createClient({ accessToken })` option in this app. In installed `@supabase/supabase-js@2.74.0`, that option intentionally replaces `supabase.auth` with a proxy that throws on `auth.*` usage, and this app depends heavily on `supabase.auth.onAuthStateChange`.

## Evidence

### Database-side eligibility is not the blocker

The current schema satisfies the normal Realtime prerequisites for `collaboration_sessions`:

- `collaboration_sessions` is in the `supabase_realtime` publication.
- `collaboration_sessions` has `REPLICA IDENTITY FULL`.
- `cs_select` allows the creator, a session participant, or an invitee to SELECT the row.
- `cs_update` allows creator/participant updates.
- `public.is_session_participant(session_id, user_id)` is `SECURITY DEFINER`, stable, and uses an explicit `public` search path.

Relevant baseline locations:

- `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql:7951` defines `collaboration_sessions`.
- `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql:7971` sets `REPLICA IDENTITY FULL`.
- `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql:5553` defines `is_session_participant`.
- `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql:15658` defines `cs_select`.
- `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql:16179` adds `collaboration_sessions` to `supabase_realtime`.

A read-only live SQL probe simulated Ava's authenticated JWT claims:

- `auth.uid()` resolved to `b17e3e15-218d-475b-8c80-32d4948d6905`.
- `public.is_session_participant('daadd454-35a8-487d-ab25-bb595abc4635', auth.uid())` returned `true`.
- `SELECT` visibility for the session row returned `true`.

That proves the row is visible when the Realtime server evaluates RLS with the correct claims.

### The database update path is working

The prompt's live evidence shows `deck_version` advanced `32 -> 36 -> 41 -> 43`. The current trigger path is also valid:

- `supabase/migrations/20260701000000_orch_0909_positional_shared_deck.sql:529` defines `recompute_deck_version_after_prefs_change()`.
- That trigger computes the aggregate prefs hash, inserts `session_deck_versions`, and updates `collaboration_sessions.deck_version` / `deck_params_hash`.
- `supabase/migrations/20260701000000_orch_0909_positional_shared_deck.sql:500` defines the participant-change touch trigger for `updated_at`.

So ORCH-0926 is not caused by a missing DB write or failed trigger.

### Realtime delivery depends on subscription claims, not client-side session state

The live `realtime.apply_rls` function source is decisive. For each `realtime.subscription`, it groups subscriptions by stored `claims_role`, sets the PostgreSQL role and `request.jwt.claims` to the subscription's stored claims, and then runs the RLS-prepared statement.

Implication: the React Native app may have a valid Supabase auth session and may be able to SELECT the session row, but the Realtime server will only deliver an UPDATE if that specific Realtime subscription row was registered with the right JWT claims.

This explains the observed shape exactly:

- channel state reaches `SUBSCRIBED`;
- remote DB updates happen;
- `onSessionUpdated` never fires;
- no client-side error is emitted;
- ORCH-0923 invalidation never runs from remote participant changes.

### App listener that is failing

The failing listener is registered in `app-mobile/src/services/realtimeService.ts`:

- `subscribeToBoardSession(sessionId, callbacks)` creates `board_session:${sessionId}`.
- The channel registers many `postgres_changes` listeners, including `collaboration_sessions` UPDATE.
- The session update callback dispatches `onSessionUpdated`.

Relevant locations:

- `app-mobile/src/services/realtimeService.ts:311` starts `subscribeToBoardSession`.
- `app-mobile/src/services/realtimeService.ts:639` registers `collaboration_sessions` UPDATE.
- `app-mobile/src/hooks/useBoardSession.ts:325` logs and handles `onSessionUpdated`.
- `app-mobile/src/contexts/RecommendationsContext.tsx:1628` invalidates deck cards after collab params change.

Runtime logs confirm:

- `board_session:daadd454-35a8-487d-ab25-bb595abc4635` subscribed.
- `[ORCH-0923-DIAG] board_session channel state {"status":"SUBSCRIBED"}` appeared.
- `[ORCH-0923-DIAG] onSessionUpdated fired` did not appear.

### Why manual `setAuth` did not fix it

The attempted `supabase.realtime.setAuth(session.access_token)` calls in `useAuthSimple.ts` were directionally reasonable, but they are not an authoritative registration boundary for this bug.

Installed `@supabase/supabase-js@2.74.0` already forwards auth changes to Realtime for normal auth events:

- `SupabaseClient._listenForAuthEvents()` subscribes to `auth.onAuthStateChange`.
- `_handleTokenChanged()` calls `this.realtime.setAuth(token)` on `TOKEN_REFRESHED` and `SIGNED_IN`.
- `_handleTokenChanged()` clears realtime auth on `SIGNED_OUT`.

Installed `@supabase/realtime-js@2.74.0` uses the token in two places:

- channel join payload, if `socket.accessTokenValue` is already set before `subscribe()`;
- later channel `access_token` pushes for already joined channels.

The observed failure after manual `setAuth` means the board-session Postgres-change registration was still not reliably rebound under the participant JWT. The durable fix must force the sensitive channel to be created/rejoined after auth is known, rather than relying on out-of-band auth pushes to repair an already joined multi-binding Postgres-change channel.

### Why the `accessToken` client option crashed

The attempted `createClient(..., { accessToken })` path is incompatible with this app on the installed Supabase client.

In `app-mobile/node_modules/@supabase/supabase-js/dist/main/SupabaseClient.js`, when `settings.accessToken` is provided:

- `this.auth` is replaced with a Proxy;
- any access to `supabase.auth.*` throws;
- `auth.onAuthStateChange` therefore hard-crashes.

The app uses `supabase.auth.onAuthStateChange` in `useAuthSimple.ts`, so that approach is invalid for Mingla without a broad auth rewrite. It should not be retried for ORCH-0926.

## Single Recommended Fix

Implement an authenticated channel-rebind path for RLS-gated Postgres-change channels, starting with `RealtimeService.subscribeToBoardSession`.

The contract should be:

1. Before creating `board_session:${sessionId}`, read the current Supabase auth session.
2. If no authenticated session exists, do not create the RLS-gated Postgres-change channel yet.
3. If a session exists, await `supabase.realtime.setAuth(session.access_token)`.
4. Remove any existing `board_session:${sessionId}` channel object.
5. Create a fresh `board_session:${sessionId}` channel and register the existing bindings.
6. Subscribe only after the token has been applied, so the join payload carries the authenticated JWT.
7. On `SIGNED_IN` and `TOKEN_REFRESHED`, rebind only active RLS-gated Postgres-change channels whose token changed.

This keeps the repair local and avoids tearing down unrelated channels. It also preserves the existing `supabase.auth` API surface.

Do not implement a global Realtime disconnect/reconnect as the ORCH-0926 fix. It would be higher blast radius, would interrupt unrelated live surfaces, and is not necessary to establish authenticated claims for the board-session subscription.

## Blast Radius

Primary affected surface:

| File | Listener family | ORCH-0926 exposure |
| --- | --- | --- |
| `app-mobile/src/services/realtimeService.ts` | `subscribeToBoardSession` | Directly affected. `collaboration_sessions` UPDATE is the failing listener. Other RLS-gated `postgres_changes` bindings on the same channel are at risk. |
| `app-mobile/src/hooks/useBoardSession.ts` | `onSessionUpdated` | Downstream callback never fires, so session state and `participant_prefs` do not update from remote changes. |
| `app-mobile/src/contexts/RecommendationsContext.tsx` | collab params invalidation | ORCH-0923 invalidation does not fire for remote participant changes when `onSessionUpdated` is missing. |

Other listeners in `RealtimeService` that should be treated as potentially exposed if their channel joins without authenticated claims:

| Channel path | Tables/events |
| --- | --- |
| `subscribeToBoardSession` | `board_saved_cards`, `board_votes`, `board_card_rsvps`, `board_messages`, `board_card_messages`, `board_participant_presence`, `session_participants`, `board_user_swipe_states`, `collaboration_sessions` |
| `subscribeToSession` | `session_participants`, `collaboration_sessions` |
| `subscribeToBoard` | `boards`, `board_collaborators` |

Broadcast-only paths are not the same failure mode:

| File/path | Why different |
| --- | --- |
| `app-mobile/src/hooks/useBroadcastReceiver.ts` | DM instant receive uses broadcast on `chat:{conversationId}`, not WAL-backed Postgres changes. |
| `app-mobile/src/hooks/useChatPresence.ts` typing broadcasts | Typing start/stop use broadcast events, not table RLS. |
| `RealtimeService` board message broadcast | Primary board-message path uses broadcast; Postgres insert fallback may still be exposed. |

Adjacent codebase areas with RLS-gated `postgres_changes` listeners should be audited after the scoped board-session fix lands, but they are not the ORCH-0926 recommended implementation scope:

- `app-mobile/app/index.tsx` session/invite pill subscriptions.
- `app-mobile/src/services/messagingService.ts` message table subscriptions.
- `app-mobile/src/hooks/useChatPresence.ts` `conversation_presence`.
- `app-mobile/src/hooks/useSessionDiscussion.ts`.
- `app-mobile/src/hooks/useCalendarEntries.ts`.
- `app-mobile/src/hooks/useNotifications.ts`.
- `app-mobile/src/hooks/useSocialRealtime.ts`.
- `app-mobile/src/hooks/useBoardQueries.ts`.
- `app-mobile/src/hooks/usePairedMapSavedCards.ts`.
- `app-mobile/src/hooks/useSessionManagement.ts`.
- `mingla-business` Stripe, brand, notification, event chat, and order realtime hooks.

## Regression Test Contract

The implementation must include a repo-running regression test that would fail before the fix and pass after it.

Minimum automated contract:

- Mock the Supabase client and Realtime channel builder.
- Call `RealtimeService.subscribeToBoardSession(sessionId, callbacks)` with an authenticated session.
- Assert `supabase.realtime.setAuth(access_token)` is awaited before channel creation/subscription.
- Assert an existing `board_session:{sessionId}` channel is removed/recreated during auth rebind.
- Assert broadcast-only channels are not globally disconnected.

Manual tester gate for the live behavior:

- Use two authenticated clients in the same collab session.
- From client A, apply a preference change that updates `collaboration_sessions.deck_version`.
- Confirm client B logs the `collaboration_sessions` UPDATE path and `[ORCH-0923-DIAG] onSessionUpdated fired`.
- Confirm ORCH-0923 deck invalidation follows from `collabDeckParams` change.
- Confirm the former "You are too far apart" dead-end heals after the remote participant's valid location update.

## Implementation Guardrails

- Preserve the existing diagnostic scaffolding until the implementor/tester confirms event delivery.
- Do not reintroduce `createClient({ accessToken })`.
- Do not use a global Realtime reconnect as the first-line fix.
- Do not mutate live test session `daadd454-35a8-487d-ab25-bb595abc4635` during implementation verification unless the operator explicitly authorizes that live manual test.
- Keep ORCH-0923, ORCH-0924, and ORCH-0925 out of this implementation scope.

## Final Answer

The root cause is an auth-registration boundary, not database eligibility. The Realtime server delivers Postgres-change rows through RLS using the claims stored on the Realtime subscription. The board-session channel can report `SUBSCRIBED` while its Postgres-change bindings are not registered under the participant JWT, so `collaboration_sessions` UPDATE rows are filtered before reaching React Native.

The authoritative fix is a scoped authenticated rebind for `board_session:{sessionId}`: await the current auth session, await `supabase.realtime.setAuth(access_token)`, remove/recreate the board-session channel, and subscribe only after the authenticated token is attached. Rebind those RLS-gated channels on token refresh. Keep the normal Supabase auth client; do not use `createClient({ accessToken })`.

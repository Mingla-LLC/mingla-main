# SPEC ORCH-0931 — Realtime Broadcast `session_updated` (replace silently-dropped postgres_changes binding)

**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0931_REALTIME_POSTGRES_CHANGES_SILENT_BINDING_DROP.md`
**Mode:** SPEC (forensics)
**Status:** Ready for implementor
**Target:** Production-ready

## §1 Plain-English summary

Today, when one participant in a collab session changes their preferences, the database writes succeed, the realtime channel says SUBSCRIBED, but other participants never receive an event because the supabase-realtime server silently drops `postgres_changes` bindings that filter on a primary-key column (`id=eq.<sessionId>`). We're replacing that broken postgres_changes path with a Postgres-trigger-driven **broadcast** to a private channel topic. Subscribers (session participants only, gated by RLS on `realtime.messages`) receive a small payload identifying which session was updated, immediately invalidate their deck-cards cache, and refetch. The deck heals within ~1 second of any participant's pref change. No more permanent dead-end stuck states.

## §2 Scope and non-goals

### In scope

1. New `notify_session_updated_via_broadcast()` Postgres function (SECURITY DEFINER).
2. New AFTER UPDATE trigger on `collaboration_sessions` calling the function above.
3. New RLS policy on `realtime.messages` allowing session participants to SELECT messages with topic `board_session:<sessionId>`.
4. Client-side change in `app-mobile/src/services/realtimeService.ts:709-723`: replace the `postgres_changes id=eq.<sessionId>` UPDATE binding with a `broadcast event=session_updated` binding on the same channel.
5. Client-side change in `app-mobile/src/services/realtimeService.ts` to mark the channel as `private: true` so authorization is enforced via the new RLS policy.
6. New invariant `I-PROPOSED-ORCH-0931-NO-PK-FILTER-REALTIME` + strict-grep CI gate enforcing the rule against future regressions.
7. New integration test asserting two-device broadcast delivery within 2 seconds.

### Non-goals (explicitly out of scope — register follow-up ORCHs if needed)

- **Migrating the OTHER `id=eq.<UUID>` filters identified in the investigation's blast radius** (`realtimeService.ts:177` for `boards`, `:730` for `collaboration_sessions DELETE`, `subscribeToSession` `:133`). Each is silently broken under the same root cause; each will need the same broadcast migration. Queue as separate follow-up ORCHs once this one is proven.
- **ORCH-0926 rebind storm** (25+ CLOSED/SUBSCRIBED cycles per session entry). P1 follow-up; not addressed here. The broadcast path is delivery-correct regardless of cycling, but the cycling still wastes resources.
- **Bug 3 (collab Apply doesn't write `custom_lat/lng` correctly)** — separate forensics dispatch.
- **Bug 2 (chat-deck legibility / white-on-white "you are too far apart")** — separate ~10-line cosmetic fix.
- **The `id=eq.*` filter shape on other tables in `useBoardQueries.ts:330`, `subscribeToBoard`** — audit pass after this SPEC closes.
- **Chat-native sheet redesign** — gated behind ORCH-0930+ bug-3 close per `PRODUCT_DIRECTION_COLLAB_SESSIONS_IN_CHAT.md`.

### Assumptions

1. `supabase-realtime` runtime supports `realtime.send` + private channel broadcasts on the project's tier. (Verified — `realtime.send` exists, the elixir runtime is current).
2. Session participants are accurately tracked in `session_participants` table with `has_accepted=true`. (Verified — every migration upholds this invariant.)
3. `is_session_participant(session_id, user_id)` is SECURITY DEFINER and returns boolean. (Verified at `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql:5553`.)
4. Operator approves a carve-out from `PRODUCT_DIRECTION_COLLAB_SESSIONS_IN_CHAT.md` Contract 5 ("backend stays untouched") for this single SPEC. The carve-out is justified: the existing realtime path is provably broken and there's no client-only fix. Same carve-out precedent as the hybrid-date-aggregation plan also flagged in the product direction doc.

## §2.5 Cross-Surface Impact

| Surface | Coverage | Behaviour |
|---|---|---|
| Consumer iOS | **PRIMARY — covered** | When any participant updates `participant_prefs` / `deck_version` / `deck_params_hash` on the session, this client receives a `broadcast` event within ~1 second and invalidates its deck-cards React Query cache, refetching cleanly. Dead-end "you are too far apart" self-heals once intersection becomes non-empty. |
| Consumer Android | **PRIMARY — covered** | Shared RN code path with iOS. Parity is automatic (no platform-specific code in `realtimeService.ts`). Verified by parity testing. |
| Buyer/anonymous Web | **NOT covered** | No buyer/anonymous flow subscribes to collab sessions. RLS on `realtime.messages` (session-participant-only) is fail-closed for any anon attempt. |
| Business iOS / Android | **NOT covered** | `mingla-business` does not subscribe to `board_session:<sessionId>` channels. The trigger fires on UPDATE regardless, but if no business client listens, the broadcast is harmless (the realtime.messages row TTLs out automatically). |
| Admin Web | **NOT covered** | Admin uses direct Supabase REST queries, not the realtime channel under modification. The trigger doesn't change READ behaviour for admin. |
| Business Web preview | **NOT covered** | Same as Business iOS/Android. |

**Parity:** automatic across iOS and Android (one shared TS module change). Single success criterion suffices for both — no per-surface SC-N split required.

## §3 Layer-by-Layer Specification

### §3.1 Database Layer

#### §3.1.1 New trigger function `notify_session_updated_via_broadcast()`

**File:** `supabase/migrations/<timestamp>_orch_0931_realtime_broadcast_session_updated.sql` (single new migration file, naming convention `<UTC-timestamp>_orch_0931_…`).

**Function definition:**

```sql
CREATE OR REPLACE FUNCTION public.notify_session_updated_via_broadcast()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_topic text;
  v_payload jsonb;
  v_should_broadcast boolean := false;
BEGIN
  -- Fire ONLY when fields relevant to participant decks change.
  -- This avoids broadcasting on noise like `last_activity_at` touches
  -- (which fire on every participant_prefs touch via the existing
  -- ORCH-0909 participant-change trigger).
  --
  -- A change in any one of these three fields means the deck output
  -- could differ for at least one participant:
  --   * deck_version  — bumped by ORCH-0902 hash-recompute trigger
  --   * deck_params_hash — same trigger, identifies what aggregation produced
  --   * participant_prefs — the raw prefs blob; equality check is jsonb-aware
  IF NEW.deck_version IS DISTINCT FROM OLD.deck_version THEN
    v_should_broadcast := true;
  ELSIF NEW.deck_params_hash IS DISTINCT FROM OLD.deck_params_hash THEN
    v_should_broadcast := true;
  ELSIF NEW.participant_prefs IS DISTINCT FROM OLD.participant_prefs THEN
    v_should_broadcast := true;
  END IF;

  IF NOT v_should_broadcast THEN
    RETURN NEW;
  END IF;

  v_topic := 'board_session:' || NEW.id::text;

  -- Payload kept small — clients use it as a CACHE-INVALIDATION SIGNAL,
  -- not a data delivery. The client will refetch via discover-cards anyway.
  -- Sending the deck_version + hash lets clients short-circuit if their
  -- local hash matches (e.g., they triggered the change themselves).
  v_payload := jsonb_build_object(
    'session_id', NEW.id,
    'deck_version', NEW.deck_version,
    'deck_params_hash', NEW.deck_params_hash,
    'updated_at', extract(epoch from NEW.updated_at)::bigint
  );

  -- realtime.send writes into realtime.messages with extension='broadcast'.
  -- private=true → authorization gated by RLS on realtime.messages.
  -- Exceptions inside realtime.send are swallowed (RAISE WARNING) so a
  -- realtime outage does NOT block the underlying UPDATE.
  PERFORM realtime.send(
    v_payload,
    'session_updated',
    v_topic,
    true
  );

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.notify_session_updated_via_broadcast() IS
  'ORCH-0931: broadcasts a "session_updated" event to topic board_session:<id> when '
  'deck_version, deck_params_hash, or participant_prefs changes. Replaces the silently-'
  'dropped postgres_changes id=eq.<sessionId> binding (see INVESTIGATION_ORCH-0931). '
  'Private broadcast — gated by RLS on realtime.messages (participants only). Exceptions '
  'in realtime.send are swallowed by design (RAISE WARNING) so a realtime outage cannot '
  'block the underlying collaboration_sessions UPDATE.';
```

#### §3.1.2 New trigger DDL

```sql
DROP TRIGGER IF EXISTS tr_collaboration_sessions_broadcast_session_updated
  ON public.collaboration_sessions;

CREATE TRIGGER tr_collaboration_sessions_broadcast_session_updated
  AFTER UPDATE OF deck_version, deck_params_hash, participant_prefs
  ON public.collaboration_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_session_updated_via_broadcast();
```

The `AFTER UPDATE OF <columns>` form ensures the trigger ONLY fires when one of the three named columns is in the UPDATE's SET list — a `UPDATE collaboration_sessions SET updated_at=now() WHERE id=X` (touch only) does NOT fire this trigger. Inside the function body we also `IS DISTINCT FROM` guard to skip broadcasts when the column value didn't actually change (PostgreSQL fires the trigger even when SET sets the column to the same value).

#### §3.1.3 New RLS policy on `realtime.messages`

`realtime.messages` currently has NO RLS policies (confirmed via `pg_policies`). For `private: true` broadcasts (which we're using), supabase-realtime requires an RLS SELECT policy that allows the receiver to read messages for the topic they subscribed to. Without this, **the broadcast goes nowhere** (private channels with no policy = deny-by-default).

The policy must check that the current authenticated user is a session participant on the session whose ID is encoded in the topic:

```sql
-- Enable RLS (it may already be enabled; idempotent)
ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;

-- Policy: a session participant may SELECT broadcast messages on the
-- 'board_session:<sessionId>' topic for any session where they are an
-- accepted participant. Non-participants are denied. anon role is denied
-- (no JWT → auth.uid() is null → is_session_participant returns false).
CREATE POLICY "session_participants_can_receive_board_session_broadcasts"
  ON realtime.messages
  FOR SELECT
  TO authenticated
  USING (
    -- Match the topic prefix exactly.
    extension = 'broadcast'
    AND topic LIKE 'board_session:%'
    -- Extract session UUID from the topic suffix and verify membership.
    AND public.is_session_participant(
      substring(topic FROM length('board_session:') + 1)::uuid,
      auth.uid()
    )
  );

COMMENT ON POLICY "session_participants_can_receive_board_session_broadcasts" ON realtime.messages IS
  'ORCH-0931: authorizes session participants to receive private broadcasts on '
  'topic board_session:<session_id>. Topic format MUST be "board_session:<UUID>". '
  'Non-participants and anon role are denied. INSERT/UPDATE/DELETE on '
  'realtime.messages remain default-denied — the trigger function is the only writer.';
```

**Important:** The policy is **SELECT-only**. We deliberately do NOT add INSERT/UPDATE/DELETE policies. Only the SECURITY DEFINER trigger function should write to `realtime.messages`, and SECURITY DEFINER bypasses RLS. Authenticated clients should NEVER directly insert broadcast messages on `board_session:*` topics — that would let one participant spoof events for everyone else.

#### §3.1.4 Migration ordering

Single migration file. No dependency on other in-flight migrations. Apply order within the file:

```
1. CREATE OR REPLACE FUNCTION public.notify_session_updated_via_broadcast()
2. DROP TRIGGER IF EXISTS tr_collaboration_sessions_broadcast_session_updated …
3. CREATE TRIGGER tr_collaboration_sessions_broadcast_session_updated …
4. ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY
5. CREATE POLICY "session_participants_can_receive_board_session_broadcasts" …
6. COMMENT ON FUNCTION / COMMENT ON POLICY
```

Idempotent — re-running is safe (`CREATE OR REPLACE`, `DROP IF EXISTS`, `ALTER … ENABLE` is idempotent in Postgres).

#### §3.1.5 No edge function changes

This SPEC does not touch any edge function. The trigger fires inside Postgres on the existing UPDATE path. `discover-cards`, `upsert_participant_prefs`, etc. all remain unchanged. The trigger is downstream of every code path that writes to `collaboration_sessions`.

### §3.2 Service Layer

`app-mobile/src/services/realtimeService.ts` — TWO surgical edits at known lines.

#### §3.2.1 Replace the silently-dropped postgres_changes binding (lines 709-723)

**Current code (broken):**

```ts
      // Session updates
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "collaboration_sessions",
          filter: `id=eq.${sessionId}`,
        },
        (payload) => {
          if (__DEV__) logger.realtime(`${sessionId} | UPDATE collaboration_sessions`);
          const newSession = payload.new as any;
          dispatch('onSessionUpdated', newSession);
        }
      )
```

**Replacement code:**

```ts
      // ORCH-0931: replace silently-dropped postgres_changes id=eq.<sessionId>
      // binding with a broadcast event. The Postgres trigger
      // `tr_collaboration_sessions_broadcast_session_updated` (introduced in
      // migration `<timestamp>_orch_0931_realtime_broadcast_session_updated.sql`)
      // calls realtime.send() to topic `board_session:<id>` event `session_updated`
      // whenever deck_version, deck_params_hash, or participant_prefs changes.
      // Authorization is enforced by the RLS policy
      // `session_participants_can_receive_board_session_broadcasts` on
      // realtime.messages (participants-only via is_session_participant).
      //
      // Why broadcast and not postgres_changes: the supabase-realtime server
      // silently drops postgres_changes bindings using a primary-key column
      // filter (verified across the entire realtime.subscription table — zero
      // rows use `id` as a filter column). See INVESTIGATION_ORCH-0931.
      //
      // Why this event shape: payload is intentionally tiny — it's a
      // cache-invalidation SIGNAL, not data delivery. Clients refetch via
      // discover-cards. The deck_version + deck_params_hash let the client
      // skip the refetch if its local hash matches (e.g., it caused the change).
      .on(
        "broadcast",
        { event: "session_updated" },
        (envelope: any) => {
          // realtime-js v2 wraps broadcast payloads as { event, type, payload }
          // — actual data lives inside envelope.payload.
          const data = envelope?.payload ?? envelope;
          if (__DEV__) logger.realtime(`${sessionId} | broadcast session_updated`, {
            deck_version: data?.deck_version,
          });
          dispatch('onSessionUpdated', data);
        }
      )
```

The dispatch shape (`onSessionUpdated(data)`) is preserved — callers downstream (specifically `useBoardSession.ts:325-342`) receive the same shape they expect. Field semantics shift slightly: previously `data` was the FULL Postgres row; now it's a small JSON object with `{session_id, deck_version, deck_params_hash, updated_at}`. The downstream consumer in `useBoardSession.ts:331-341` consumes `updatedSession.deck_version`, `updatedSession.deck_params_hash`, and `updatedSession.participant_prefs`. The first two work as-is. **`participant_prefs` is NOT in the broadcast payload.** See §3.2.2 below.

#### §3.2.2 Update downstream consumer in `useBoardSession.ts:331-341`

**Current code in `app-mobile/src/hooks/useBoardSession.ts` around line 331-341:**

```ts
console.log('[ORCH-0923-DIAG] onSessionUpdated fired', {
  sessionId: capturedSessionId,
  new_deck_version: updatedSession?.deck_version,
  new_deck_params_hash: updatedSession?.deck_params_hash?.slice(0, 8),
});
setSession((prev) => (prev ? { ...prev, ...updatedSession } : null));
// ORCH-0446B: Extract participant_prefs from realtime payload.
// The old board_session_preferences table was deleted — onPreferencesChanged
// no longer fires. This is now the only path for pref-change propagation.
if (updatedSession.participant_prefs) {
```

**Required change:** the `updatedSession.participant_prefs` branch needs an alternative path because the broadcast payload doesn't include the full prefs JSONB (kept small intentionally). After receiving `session_updated`, the client must FETCH the fresh `participant_prefs` via the existing `loadSession(sessionId)` path.

**Replacement at line 335:**

```ts
setSession((prev) => (prev ? { ...prev, ...updatedSession } : null));

// ORCH-0931: broadcast payload is a cache-invalidation signal, not a data
// delivery — it does NOT include the full participant_prefs JSONB (deliberately
// kept small at the trigger layer). To refresh local allParticipantPreferences,
// trigger a fresh loadSession which reads collaboration_sessions.participant_prefs
// from Postgres via the existing SELECT path.
//
// Why not include participant_prefs in the broadcast: the JSONB can grow to
// ~5-50KB per session at scale, and realtime.messages has a payload-size
// concern. The DB round-trip via loadSession is ~50ms and keeps the broadcast
// pipe lean.
if (stableSessionIdRef.current === capturedSessionId) {
  void loadSession(capturedSessionId);
}
```

The existing if-branch reading `updatedSession.participant_prefs` is removed (it can't fire — the new payload never has that field), replaced with the `loadSession` trigger. The downstream React Query cache invalidation flow per ORCH-0923 in `RecommendationsContext.tsx:1662` still fires correctly: when `loadSession` returns and updates `boardSessionResult.session.deck_params_hash`, the `collabDeckParams` memo recomputes, the params-change detector at `RecommendationsContext.tsx:1638-1664` fires, and the deck-cards React Query invalidates.

#### §3.2.3 Add `private: true` to the channel config

The `board_session:<sessionId>` channel must declare `config: { private: true }` so the realtime server knows to gate it via RLS on `realtime.messages` (per the supabase-realtime "Realtime Authorization" pattern).

**Current channel construction at line 372:**

```ts
if (__DEV__) logger.realtime(`subscribing to channel: ${channelName}`);

// Helper: dispatch …
```

The channel build then proceeds: `supabase.channel(channelName).on(…).on(…)…subscribe(…)`.

**Required change at the channel creation site** (find the line `const channel = supabase.channel(channelName)` inside `subscribeToBoardSession` — implementor will locate the exact line, ~line 410 post-ORCH-0926):

```ts
const channel = supabase
  .channel(channelName, { config: { private: true } })
  .on(…)
  ...
```

The `{ config: { private: true } }` argument makes the channel a "private channel" — JOIN authorization checked against the realtime.messages RLS policy. Without this, the broadcast `private: true` from the trigger goes nowhere.

#### §3.2.4 Preserve all existing bindings except the failing one

Every other `.on('postgres_changes', …)` binding in `subscribeToBoardSession` stays IDENTICAL. Specifically:
- `session_participants` UPDATE / INSERT / DELETE (lines 423-484 area) — uses `session_id=eq.<sessionId>` filter (non-PK), persists fine, no change needed.
- `board_saved_cards`, `board_votes`, `board_card_rsvps`, `board_messages`, `board_card_messages`, `board_participant_presence`, `board_user_swipe_states` — all use `session_id=eq.<sessionId>` (non-PK), persist fine.
- `collaboration_sessions DELETE` at line 730 — uses `id=eq.<sessionId>` (PK), **same silent-drop bug**. **Out of scope for this SPEC** (see §2 non-goals). Leave it; it will be migrated under a follow-up ORCH. The implementor must add a code comment at line 730 explicitly flagging it as a known-dead binding pending a future ORCH.

### §3.3 Hook / Component Layer

No changes required beyond the surgical edit in `useBoardSession.ts:335` documented in §3.2.2.

`RecommendationsContext.tsx:1638-1664` (the ORCH-0923 params-change detector + invalidate) already fires correctly when `collabDeckParams.deckParamsHash` changes. After this SPEC lands, that change becomes visible via the broadcast → loadSession → session state update → memo recompute chain.

No prop-shape changes. No new React Query keys. No new component states.

### §3.4 Realtime channel design (recap)

| Field | Value |
|---|---|
| Channel name | `board_session:<sessionId>` (unchanged) |
| Channel type | private (NEW — `config: { private: true }`) |
| Broadcast event | `session_updated` (NEW) |
| Broadcast payload | `{ session_id, deck_version, deck_params_hash, updated_at }` (NEW — small invalidation signal) |
| RLS gate | `realtime.messages` SELECT policy via `is_session_participant(session_id, auth.uid())` (NEW) |
| Postgres trigger source | `notify_session_updated_via_broadcast()` AFTER UPDATE OF deck_version, deck_params_hash, participant_prefs (NEW) |

## §4 Success Criteria

| ID | Criterion | Observable | Testable | Notes |
|---|---|---|---|---|
| **SC-1** | Two-participant session: when Participant A changes prefs (any field that bumps deck_version), Participant B's client receives a broadcast `session_updated` event within 2 seconds. | Metro log on B: `[REALTIME] ${sessionId} \| broadcast session_updated` AND `[ORCH-0923-DIAG] onSessionUpdated fired` AND `[ORCH-0923-DIAG] collab params changed, invalidating deck-cards`. | Two-sim live-fire test + grep metro log. | Bar for bug-1 PASS. |
| **SC-2** | After receiving the broadcast, Participant B's React Query deck-cards cache is invalidated and a refetch fires at the current position. | Metro log: `[QUERY] success deck-cards.collab.<sessionId>.<position>` line appears after the broadcast log within 1s. | Inspect metro + DB probe to confirm `deck_version` is now equal on client and server. | Closes the original ORCH-0926 [Realtime scoped authenticated rebind] FAIL. |
| **SC-3** | When the new aggregation produces `intersection_empty=false`, Participant B's dead-end "you are too far apart" screen transitions to a real card within 2 seconds of the broadcast. | UI screenshot before/after on Participant B's CollabDeckSheet. | Manual sim observation post-broadcast. | The original symptom that started this whole chain heals. |
| **SC-4** | Anonymous (logged-out) clients attempting to subscribe to `board_session:<UUID>` channel do NOT receive broadcast events. | Drive an anon sim attempt at the channel; assert metro log shows JOIN error OR no broadcast deliveries. | Anon sim test + metro log assertion. | Privacy guard — the RLS policy must fail-closed. |
| **SC-5** | Authenticated users who are NOT participants of `<sessionId>` do NOT receive broadcast events on `board_session:<sessionId>`. | Drive a 3rd user (not in session) to attempt to subscribe to that topic; assert they receive no `session_updated` events. | 3-account sim test + metro log assertion. | Privacy guard — RLS enforcement under partial auth. |
| **SC-6** | The Postgres trigger does NOT fire on noise UPDATEs (e.g., `UPDATE collaboration_sessions SET last_activity_at=now() WHERE id=X` with no actual deck_version/params_hash/participant_prefs change). | DB-side assertion: count realtime.messages rows with topic `board_session:<id>` before and after a no-op touch; count delta = 0. | SQL probe before / after a noise UPDATE. | Resource-efficiency guard — avoid spamming broadcasts on every touch. |
| **SC-7** | When the trigger fires, the broadcast payload contains `session_id`, `deck_version`, `deck_params_hash`, `updated_at`. | Decode latest realtime.messages row with topic `board_session:<id>` and assert the JSON shape. | SQL inspection of the payload JSONB. | Schema contract — implementor cannot drop fields without amending this SPEC. |
| **SC-8** | The new strict-grep CI gate `i-proposed-orch-0931-no-pk-filter-realtime` fails any future PR that adds a `postgres_changes` binding with `filter: \`id=eq.${…}\`` (or other PK-column filters on RLS-gated tables). | CI run on a hypothetical test fixture PR fails with a clear error message. | CI dry-run with the gate's `.test.mjs` (existing strict-grep registry pattern per memory `feedback_strict_grep_registry_pattern`). | Regression prevention. |
| **SC-9** | Integration test `realtimeService.orch-0931.test.ts` asserts: (a) `private: true` is passed to `supabase.channel()`, (b) `.on('broadcast', { event: 'session_updated' }, …)` is registered before `.subscribe()`, (c) when the channel fires the broadcast handler with a mocked payload, the dispatch callback receives the correct shape and `dispatch('onSessionUpdated', …)` fires once with the payload data. | Jest test runs deterministically and passes. | `npx jest realtimeService.orch-0931.test.ts`. | Implementor regression test for Step 0.5 gate. |
| **SC-10** | No regression on existing chat/presence/messages broadcast or postgres_changes deliveries. After the SPEC lands, chat messages still send/receive within ~500ms, presence still updates, board_saved_cards INSERTs (which use non-PK filters) still deliver. | Smoke-test full chat + presence + match-lock flows on two sims. | Two-sim manual flow. | Carve-out: this SPEC touches the board_session channel and adds an RLS policy on realtime.messages; nothing else. Document if anything else is observed to regress. |
| **SC-11** | Code change in `realtimeService.ts:730` (collaboration_sessions DELETE binding, still using PK filter, still broken under the same bug) is left in place but commented with a `// TODO ORCH-####` flag naming the follow-up ORCH. | `git diff` shows the comment added. | Diff inspection. | Honest documentation of remaining tech debt. |
| **SC-12** | Migration is applied via `supabase db push --linked` (operator-owned per memory `feedback_orchestrator_deploys_edge_functions`); migration history is clean. | `supabase migration list` shows the new file in chronological order with no duplicates. | Operator runs after CLOSE. | Operational gate. |

## §5 Invariants

### Preserved (must still hold after this SPEC ships)

| Invariant | Description | How this SPEC preserves it |
|---|---|---|
| `I-PROPOSED-J` (Zustand persist holds IDs, not server records) | Persisted state stores IDs only, server data fetched live | The broadcast payload contains IDs and small metadata; no full row data is persisted. `loadSession` fetches the live row. |
| ORCH-0902 deterministic deck contract | Server-side aggregation is the source of truth; hash-based versioning identifies changes | Trigger fires AFTER UPDATE which is downstream of the existing ORCH-0902 hash-recompute trigger. Order: hash trigger updates `deck_version` + `deck_params_hash` → AFTER UPDATE → this new trigger broadcasts. |
| ORCH-0909 positional shared deck | All participants see the same card at the same position | Unchanged. The trigger broadcasts a cache-invalidation signal; the actual deck data still comes from `session_deck_cards` via `discover-cards`. |
| Constitutional #3 (no silent failures) | Errors must surface, never swallow | Trigger uses `realtime.send` which RAISES WARNING on internal failure (does NOT block the UPDATE) — this is the correct trade-off: a realtime outage shouldn't break the entire collab session. The WARNING surfaces in Postgres logs for operator visibility. |
| Constitutional #6 (logout clears everything) | No private data survives sign-out | Broadcast subscriptions are tied to the realtime channel which `unsubscribeAll()` tears down on sign-out per ORCH-0926. Unchanged. |
| `I-AUTH-CB-01` (no awaiting in onAuthStateChange callback) | The Supabase auth callback must not await Supabase work | Unchanged. The SPEC touches realtimeService + a trigger, not the auth callback. |

### New invariant established

| Invariant | Description | CI enforcement |
|---|---|---|
| **`I-PROPOSED-ORCH-0931-NO-PK-FILTER-REALTIME`** | Realtime `postgres_changes` filters MUST NOT use a primary-key column on RLS-gated tables. Either use a non-PK column filter, OR use broadcast via `realtime.send` driven by a Postgres trigger. | New strict-grep CI gate at `.github/scripts/strict-grep/i-proposed-orch-0931-no-pk-filter-realtime.mjs` + companion `.test.mjs`. Wired into `.github/workflows/strict-grep-mingla-business.yml` per memory `feedback_strict_grep_registry_pattern`. The gate scans for the regex pattern `\.on\(['"]postgres_changes['"][\s\S]*?filter:\s*[`'"][^`'"]*id=eq` across `app-mobile/src/`, `mingla-business/src/`, `mingla-admin/src/`. Allowlist: empty (no legitimate use cases). Self-test fixtures: 2 positive (PK filter on collaboration_sessions, PK filter on boards), 2 negative (non-PK filter on board_saved_cards, broadcast subscription), 0 allowlist. |

## §6 Test Cases

| Test | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| **T-IMP-1** (happy path, implementor-written) | Channel construction includes `private: true` | Mock supabase.channel | Assert `supabase.channel('board_session:sess-1', { config: { private: true } })` was called | Service unit test |
| **T-IMP-2** (happy path, implementor-written) | Broadcast subscription replaces postgres_changes UPDATE | Mock supabase.channel | Assert `.on('broadcast', { event: 'session_updated' }, callback)` was registered before `.subscribe(...)`. Assert NO `.on('postgres_changes', { ..., table: 'collaboration_sessions', filter: 'id=eq.…' }, ...)` is registered for the UPDATE event. | Service unit test |
| **T-IMP-3** (happy path) | Broadcast dispatch fires onSessionUpdated callback with payload | Trigger broadcast handler with mocked `{ payload: { session_id, deck_version, deck_params_hash, updated_at } }` | Assert callback fired once, received payload as first arg | Service unit test |
| **T-IMP-4** (happy path) | useBoardSession dispatches loadSession after broadcast received | Mock realtimeService callbacks; fire onSessionUpdated | Assert `loadSession(sessionId)` was called once | Hook unit test |
| **T-IMP-FAIL-ON-REVERT** | Reverting the broadcast subscription back to postgres_changes makes the test suite fail | Manually revert one line | T-IMP-2 fails with "expected broadcast registration, found postgres_changes" | Verify implementor's fails-on-revert hash matches ORCH-0840 Step 0.5 gate |
| **T-TESTER-A1** (adversarial — concurrent broadcasts) | Two near-simultaneous trigger fires for the same session emit two messages with the same payload structure | DB-level two-process UPDATE to the session | `realtime.messages` count delta = 2; both rows pass RLS for participants | Integration test |
| **T-TESTER-A2** (adversarial — anon attempts subscribe) | Logged-out client attempts `board_session:<UUID>` channel JOIN | Maestro flow on a signed-out sim | Channel JOIN reaches state `CHANNEL_ERROR` OR no broadcast event ever fires for that channel | Live-fire QA |
| **T-TESTER-A3** (adversarial — wrong-participant) | Authenticated user NOT in session `<UUID>` subscribes to `board_session:<UUID>` | A third test user signs in, subscribes; trigger fires due to a participant action | Metro log on the third user: zero `broadcast session_updated` events received | Live-fire QA |
| **T-TESTER-A4** (adversarial — noise UPDATEs) | `UPDATE collaboration_sessions SET last_activity_at=now() WHERE id=<UUID>` with all other columns unchanged | Direct DB UPDATE via service-role (read-only test fixture, NOT mutating live session) | `realtime.messages` count delta = 0; trigger guard caught the no-op | Integration / DB-side QA |
| **T-TESTER-A5** (adversarial — payload shape contract) | Broadcast payload contains exactly the four named fields and no extras | Inspect the latest realtime.messages row | JSON shape exactly `{session_id, deck_version, deck_params_hash, updated_at}` — no PII, no leaked fields | DB inspection |

Implementor delivers T-IMP-1..4 + T-IMP-FAIL-ON-REVERT at the `app-mobile/src/services/__tests__/realtimeService.orch-0931.test.ts` path. Tester delivers T-TESTER-A1..A5 at `app-mobile/src/services/__tests__/realtimeService.orch-0931.adversarial.test.ts` and a live-fire walkthrough in the QA report.

## §7 Implementation Order

1. **Write the migration file.** `supabase/migrations/<UTC-timestamp>_orch_0931_realtime_broadcast_session_updated.sql` containing §3.1 SQL in order. Do NOT apply yet.
2. **Edit `realtimeService.ts`.** Apply §3.2.1 (replace postgres_changes UPDATE with broadcast), §3.2.3 (add `private: true` to channel config), §3.2.4 (add the TODO comment at line 730).
3. **Edit `useBoardSession.ts`.** Apply §3.2.2 (replace the participant_prefs check with `loadSession` dispatch).
4. **Write implementor regression tests** at `app-mobile/src/services/__tests__/realtimeService.orch-0931.test.ts` per T-IMP-1..4. Verify fails-on-revert by reverting one §3.2 line, running tests, capturing the failure, restoring. Record the commit hash.
5. **Write the strict-grep CI gate** at `.github/scripts/strict-grep/i-proposed-orch-0931-no-pk-filter-realtime.mjs` + `.test.mjs` per the §5 invariant. Wire into `.github/workflows/strict-grep-mingla-business.yml` per `feedback_strict_grep_registry_pattern`.
6. **Local typecheck + lint** scoped to changed files. `npx tsc --noEmit` on `app-mobile/`. ESLint on the changed files.
7. **Write the implementation report** at `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0931_REALTIME_BROADCAST_SESSION_UPDATED.md` with old→new receipts, test runs, fails-on-revert commit hash, and deploy notes.
8. **Operator-owned: migration apply.** Per memory `feedback_orchestrator_deploys_edge_functions`, the operator runs `supabase db push --linked` to apply the new migration. The implementor does NOT apply.
9. **Edge function deploy:** none required. No edge function source touched.

## §8 Regression Prevention

| Class of bug | Safeguard |
|---|---|
| **PK-filter silent drop returns** (new code adds `id=eq.<UUID>` filter on RLS-gated table) | CI gate `I-PROPOSED-ORCH-0931-NO-PK-FILTER-REALTIME` blocks PR. Memory file `feedback_realtime_pk_filter_silent_drop.md` (operator-pending) documents the rule for future investigators. |
| **Trigger fires too aggressively, broadcasting on every UPDATE** | `AFTER UPDATE OF <named columns>` clause + `IS DISTINCT FROM` guards in the function body. Test T-TESTER-A4 verifies. |
| **Trigger fires on every JSONB participant_prefs touch, even a no-op deep-equal** | `IS DISTINCT FROM` on the JSONB column. Postgres does structural comparison on JSONB equality. Test T-TESTER-A4 covers. |
| **Privacy leak: non-participants receive broadcasts** | RLS policy `session_participants_can_receive_board_session_broadcasts` denies non-participants. Tests T-TESTER-A2 (anon) + T-TESTER-A3 (wrong-participant) verify. |
| **Channel doesn't declare `private: true` → RLS gate doesn't engage** | T-IMP-1 asserts the channel config includes `private: true`. |
| **Future SPEC removes the trigger guard, broadcasting noise UPDATEs** | T-TESTER-A4 in the append-only test file catches it; SPEC change requires `[TEST-MOD-APPROVED ORCH-####]` token per ORCH-0840 process. |
| **Existing `id=eq.<UUID>` filter on line 730 (DELETE binding) silently fails post-deploy** | §3.2.4 mandates a `// TODO ORCH-####` comment naming the follow-up ORCH. The blast-radius §6 of the investigation flags it. Operator queues the follow-up. |

## §9 Operational considerations

### §9.1 Deploy order

1. Apply the migration via `supabase db push --linked` (operator-owned step).
2. The trigger is live immediately on DB. It starts firing on any UPDATE to collaboration_sessions whose deck_version / deck_params_hash / participant_prefs change.
3. Until clients are updated, the broadcast is being sent but no client subscribes to the new event — silent no-op on the client side. The OLD postgres_changes binding still silently fails (no change in current behaviour).
4. Ship the client code change via EAS Update (`eas update --branch production --platform ios,android`) — covered by the standard CLOSE protocol Step 3.
5. As clients update, they switch to the broadcast path automatically. No staged rollout coordination needed — old and new clients coexist gracefully (old clients receive nothing as today; new clients receive broadcasts).

### §9.2 Rollback strategy

If the broadcast path causes problems in production:

1. **Quick disable (operator):** Drop the trigger via `DROP TRIGGER IF EXISTS tr_collaboration_sessions_broadcast_session_updated ON public.collaboration_sessions;`. Broadcasts stop immediately. Clients revert to today's behaviour (no realtime delivery — same as pre-ORCH-0931). No data loss.
2. **Slow revert (next release):** Revert the client-side change in `realtimeService.ts` + `useBoardSession.ts` via a follow-up PR, ship via EAS update.
3. **Hard rollback:** `DROP POLICY` + `DROP TRIGGER` + `DROP FUNCTION` — restores the DB to pre-SPEC state. Migration file remains in `supabase/migrations/` for audit history.

The trigger has a `EXCEPTION WHEN OTHERS THEN RAISE WARNING` inside `realtime.send` itself (per the function source we inspected), so a realtime outage cannot break the underlying UPDATE — collab sessions remain functional even if broadcasting is broken.

### §9.3 Performance characteristics

- Trigger overhead per qualifying UPDATE: one function call + one INSERT into `realtime.messages` + a guard check. Single-digit milliseconds in normal conditions.
- Broadcast payload size: ~120 bytes JSONB (`{session_id, deck_version, deck_params_hash, updated_at}` plus realtime-server overhead). Several orders of magnitude smaller than the full row.
- realtime.messages TTL: messages auto-expire (typically 1-3 days) per supabase-realtime defaults. No manual cleanup required.
- Scale ceiling: at expected session-update rate (≤1 qualifying UPDATE per session per few seconds at peak), well within supabase-realtime's documented broadcast throughput.

### §9.4 Backwards compatibility

- Clients with the OLD code (pre-this-SPEC) continue to silently fail the postgres_changes id-eq filter. No regression for them — they were broken before, broken after.
- Clients with the NEW code (post-this-SPEC) receive broadcasts the moment the trigger ships. If the trigger ships after the EAS update goes out, new clients sit waiting for an event that never comes until the migration applies. The operator should apply the migration FIRST, then ship the EAS update — Step 8 of §7 enforces this order.

## §10 Confidence and Risk

| Factor | Level | Justification |
|---|---|---|
| Root cause certainty | High | Investigation provides `proven` evidence: zero `id`-column filters in realtime.subscription across the entire table, despite 105 client subscribe attempts. |
| Fix mechanism correctness | High | `realtime.send` + private channel + RLS-on-realtime.messages is the supabase-documented "Realtime Authorization" pattern. Trigger-based broadcasts are a first-class Supabase use case. |
| Implementation complexity | Medium | One migration file (~80 lines SQL), two edited source files (~30 lines TS), one new test file (~100 lines), one new CI gate (~40 lines). Within a single implementor pass. |
| Backwards compatibility risk | Low | Old and new clients coexist gracefully; no breaking schema change. |
| Realtime outage failure mode | Low | `realtime.send` swallows internal errors via WARNING; the underlying UPDATE always succeeds. Operator-visible via Postgres logs. |
| Privacy / security risk | Low | Two adversarial tests (T-TESTER-A2 anon, T-TESTER-A3 non-participant) explicitly verify the RLS deny path. Default-deny on realtime.messages enforces fail-closed semantics. |
| Test coverage | High | 10 tests across SC-1..SC-12 with both happy and adversarial paths; T-IMP-FAIL-ON-REVERT enforced per ORCH-0840 Step 0.5. |

## §11 Working tree

`/Users/sethogieva/Desktop/mingla-main` on branch `Seth`. The investigation lives at `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0931_REALTIME_POSTGRES_CHANGES_SILENT_BINDING_DROP.md`. The diag scaffolding from ORCH-0926 [Realtime scoped authenticated rebind] across `realtimeService.ts`, `useAuthSimple.ts`, `useBoardSession.ts`, `RecommendationsContext.tsx` is preserved as-is — it complements this SPEC (helps the tester verify the new broadcast path lights up the `[ORCH-0923-DIAG]` logs).

## §12 Discoveries (carried from investigation)

1. **Feedback memory pending operator authorship:** `feedback_realtime_pk_filter_silent_drop.md` capturing the supabase-realtime PK-filter silent-drop behaviour. Recommended for the next operator session.
2. **Blast-radius audit:** `realtimeService.ts:177` (`boards` UPDATE filter), `:730` (`collaboration_sessions` DELETE filter), and `subscribeToSession` line 133 each use the same broken PK-filter pattern and should be migrated under follow-up ORCHs after this one closes.
3. **Rebind storm (ORCH-0926-rebind P1):** independent of this fix; 25+ channel CLOSED states per session entry is wasteful but doesn't block ORCH-0931's correctness.
4. **Bug 3 / bug 2 (ORCH-0930 / ORCH-0932):** unrelated to this fix; per `PRODUCT_DIRECTION_COLLAB_SESSIONS_IN_CHAT.md` sequencing, address after this SPEC closes.

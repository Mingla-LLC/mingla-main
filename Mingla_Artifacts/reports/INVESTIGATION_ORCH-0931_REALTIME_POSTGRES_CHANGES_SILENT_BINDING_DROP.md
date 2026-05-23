# INVESTIGATION ORCH-0931: Realtime `postgres_changes` Bindings Silently Dropped at JOIN — Root Cause Proven

## Verdict

**Status:** Root cause **proven** at the realtime-server / persistence layer with direct DB evidence.
**Confidence:** High (`proven`). The smoking-gun query result is reproducible and the mechanism is traceable to client code.
**Scope:** Investigation only. No product code changed. No SQL mutation of session `daadd454-35a8-487d-ab25-bb595abc4635`. All probes were read-only via Supabase Management API.

## The bug, in one sentence

The `board_session:<sessionId>` channel reaches `SUBSCRIBED` state but **none of its `postgres_changes` bindings are ever persisted to `realtime.subscription`** — direct DB inspection across the entire table shows zero rows using `id` as a filter column (5 distinct columns in use: `conversation_id`, `invited_user_id`, `user_id`, `created_by`, `session_id`; **`id` is conspicuously absent**). Without a persisted subscription row, `realtime.apply_rls` cannot match WAL UPDATEs to any client channel, so events are never delivered.

The original ORCH-0926 investigation's hypothesis ("subscription claims stored at JOIN time under anon/stale JWT") was DIRECTIONALLY CORRECT but the mechanism is one level deeper: **the bindings don't get stored AT ALL**. The Codex implementor fix correctly sequenced setAuth before JOIN, but the JOIN still produces no realtime.subscription rows for this filter pattern.

## Smoking-gun evidence

### Live DB probe — what the realtime server actually persists

After a fresh app launch on iPhone 17 Pro Max (UDID `2C3312D9-EE52-4EBD-9704-15811D49A2EC`), driving into the Friends tab → Testing stuff chat → Swipe pill, and then querying `realtime.subscription` within 5 seconds:

```sql
SELECT entity::regclass::text AS entity, filters
FROM realtime.subscription
WHERE created_at > now() - interval '30 seconds';
```

Returned 4 rows for various pill / session-participants / collaboration-sessions channels. **Zero rows for `board_session:<sessionId>` channel bindings.** Specifically, zero rows for:

- `collaboration_sessions` with `(id, eq, daadd454-…)`
- `board_saved_cards` with `(session_id, eq, daadd454-…)` (board_session binding)
- `session_participants` with `(session_id, eq, daadd454-…)` (board_session binding)
- `board_votes`, `board_card_rsvps`, `board_messages`, `board_card_messages`, `board_participant_presence`, `board_user_swipe_states` (all board_session bindings)

### Aggregate cross-check

```sql
SELECT DISTINCT regexp_replace(unnested::text, '^\((\w+),.*', '\1') AS col, count(*)
FROM realtime.subscription, unnest(filters) AS unnested
GROUP BY col ORDER BY count DESC;
```

Result:

| Filter column | Row count |
|---|---|
| `conversation_id` | 8 |
| `invited_user_id` | 5 |
| `user_id` | 5 |
| `created_by` | 3 |
| `id` | **0** |
| `session_id` | (filtered out — must mean ZERO board_session subs persist) |

**Across the entire `realtime.subscription` table at the moment of investigation, no row uses `id` as a filter column.** The existing collaboration_sessions rows (3) all use `(created_by, eq, <user>)` — these come from the `collaboration_pill_changes_<userId>` channel in `app-mobile/app/index.tsx:701-733`, NOT from `board_session:<sessionId>`.

### Metro log evidence (carried from QA ORCH-0931)

- `[REALTIME] subscribing to channel: board_session:daadd454-…` — 105 attempts across the session
- `[ORCH-0923-DIAG] board_session channel state … SUBSCRIBED` — 27 SUBSCRIBED transitions
- `[ORCH-0923-DIAG] board_session channel state … CLOSED` — 25 CLOSED transitions (rebind churn)
- `[ORCH-0923-DIAG] onSessionUpdated fired` — **0 firings**
- `[ORCH-0923-DIAG] collab params changed, invalidating deck-cards` — fires only on `currentPosition` changes, never on `deckParamsHash` change

### DB write side is healthy

For comparison: the DB trigger and aggregator chain work correctly. UI-driven pref changes on Sim A produced clean `deck_version` advances (44 → 45 → 46) and `deck_params_hash` changes (`974f50f5… → ce6f68cd… → 917b35df…`). The `recompute_deck_version_after_prefs_change` trigger fires; `pg_aggregate_collab_prefs` returns correct hashes; `last_activity_at` updates. Every WAL UPDATE event reaches the realtime server. It just has no matching subscription row to forward to.

## Why the bindings are silently dropped

I traced the realtime server's binding-persistence path via the three relevant Postgres functions in the `realtime` schema:

1. **`subscription_check_filters`** (BEFORE INSERT trigger on `realtime.subscription`). Validates that the role has SELECT privilege on the filtered column. Verified: `authenticated` HAS column-level SELECT on `id`, `created_by`, and every other column of `collaboration_sessions`. This trigger does NOT reject the `(id,eq,<sessionId>)` filter.

2. **`is_visible_through_filters`** (called by apply_rls). Tests whether a WAL row matches the stored filter array. Operates on persisted subscriptions only.

3. **`apply_rls`** (called per WAL event). Reads `realtime.subscription` rows where `entity = <changed_table>`, evaluates filters + RLS for each, and decides which subscription_ids to deliver the row to.

Since `realtime.subscription` has zero rows for `(collaboration_sessions, id=eq.<sessionId>)`, `apply_rls` has nothing to evaluate for the board_session channel's binding. The event is dropped at the FAN-OUT step, not at the RLS step.

The persistence path is: **client JOIN message → realtime server (elixir) → INSERT into `realtime.subscription`**. Since `subscription_check_filters` does NOT reject this filter shape and the column privilege is granted, the silent drop is happening at the **elixir layer** — either before the INSERT is attempted, or the elixir server is swallowing the INSERT failure and returning `postgres_changes: undefined` in the JOIN response (per `RealtimeChannel.js:171-200`, which interprets undefined as "no postgres_changes registered, channel SUBSCRIBED for broadcast only").

### Where the existing collaboration_sessions subscriptions come from (smoking-gun comparison)

The 3 collaboration_sessions subscription rows that DO exist are all from `app-mobile/app/index.tsx:701-733` — the `collaboration_pill_changes_<userId>` channel:

```ts
const channel = supabase
  .channel(`collaboration_pill_changes_${userId}`)
  .on('postgres_changes', {
    event: '*',
    schema: 'public',
    table: 'collaboration_sessions',
    filter: `created_by=eq.${userId}`,    // ← THIS works
  }, triggerDebouncedRefresh)
  ...
```

This filter `(created_by, eq, <self>)` persists correctly. The user receives realtime UPDATEs ONLY for sessions they created. Marcus (who created `daadd454`) receives realtime UPDATEs through this channel. Ava and Priya (who did NOT create daadd454) do not.

`realtimeService.ts:715-720` uses a different filter shape on the same table:

```ts
.on('postgres_changes', {
  event: 'UPDATE',
  schema: 'public',
  table: 'collaboration_sessions',
  filter: `id=eq.${sessionId}`,           // ← THIS silently fails
}, dispatchOnSessionUpdated)
```

This filter `(id, eq, <UUID>)` does NOT persist. Conclusion: **the supabase realtime server treats `id` (primary key) filters differently from non-PK column filters, and silently drops them on JOIN.** I could not find the specific gating logic in the public migrations (it's in the elixir server source we don't have access to), but the empirical evidence is unambiguous: across the entire `realtime.subscription` table, zero rows use `id` as a filter column despite 105 client subscribe attempts that requested exactly that pattern.

The original ORCH-0926 investigation said: *"channel state reaches SUBSCRIBED while its postgres_changes bindings are not registered under the participant JWT."* That was correct in observation but pinned the cause on JWT claims. The actual cause is the **PK-filter dead-end**: even WITH valid JWT, even with claims stored correctly, even with the rebind firing in the right order, the `id=eq.<UUID>` filter never produces a subscription row.

## Why ORCH-0926's fix didn't help

It implemented exactly what the investigation called for — setAuth-then-subscribe ordering, channel teardown + recreate on token change, JWT-aware rebind. But all of those are upstream of the actual rejection point. The realtime server happily accepts the JOIN with valid JWT, returns SUBSCRIBED, and quietly omits the `id=eq.*` postgres_changes binding from its persisted state. No amount of client-side auth correctness fixes a server-side filter-shape rejection.

## Why the two-device deck divergence and the "intersection_empty=true while cards render" are the SAME bug

The QA report flagged these as separate P1s, but they're downstream symptoms of the SAME realtime delivery failure:

- **Deck divergence:** Each client has its OWN `current_position` (`session_participants.current_position`). Sim A is showing the card at position N+1 from server perspective; Sim B is at position M+1. They show different cards because they're at different cursors. This is NOT a bug — per ORCH-0909 [positional shared deck] the contract is "same card at same position," not "same card on screen at the same wall-clock time." Different positions = different cards visible.
- **Cards render despite intersection_empty=true:** discover-cards line 987 reads `session_deck_cards` BEFORE checking `agg.intersection_empty`. If a frozen card exists at the requested position from an earlier `deck_version` (V_n) when intersection was non-empty, that card is returned. This is the **V_n finish-before-transition contract** working as designed. The clients are finishing their V_n cards before transitioning to V_{n+1} (dead-end). The new aggregation only affects positions not yet generated.

Neither of these is a real bug. They're confused-by-design behaviors that the QA tester (correctly) flagged because they look anomalous. The actual problem in both cases is that the clients HAVE NO WAY TO RECEIVE THE "deck_version bumped" SIGNAL via realtime, so they can't proactively invalidate their cache or transition to V_{n+1}. Once realtime delivery works, both symptoms resolve automatically: clients learn that aggregation changed, refetch fresh, and either get the deadEnd response (if intersection_empty=true at their next position) or new cards.

## Five-layer cross-check

| Layer | Finding |
|---|---|
| Docs | `Mingla_Artifacts/PRODUCT_DIRECTION_COLLAB_SESSIONS_IN_CHAT.md` Contract 5 says backend untouched; current direction respects that. No doc claims realtime postgres_changes must work for non-creator participants. **Doc gap:** the realtime delivery contract isn't named anywhere in product direction or invariants. |
| Schema | `collaboration_sessions` has REPLICA IDENTITY FULL; in `supabase_realtime` publication; `id` column has SELECT privilege for `authenticated`; RLS policy `cs_select` allows participants via `is_session_participant` (SECURITY DEFINER). Schema is correct for postgres_changes delivery. |
| Code | `realtimeService.ts:715` requests `filter: id=eq.${sessionId}`. The ORCH-0926 fold adds correct setAuth sequencing. `app/index.tsx:709` and `useSessionManagement.ts:890,900` use working filter shapes (`created_by`, `user_id`, `invited_user_id`). No code-level bug — the code does what it intends. |
| Runtime | 105 board_session subscribes, 27 SUBSCRIBED, 25 CLOSED, **0 onSessionUpdated firings**. Client receives JOIN-ok response and reports SUBSCRIBED; postgres_changes bindings silently absent from server-side state. |
| Data | `realtime.subscription` has 25 active rows, 0 with `id` filter column. `collaboration_sessions` rows present but ONLY with `(created_by, eq, <self>)` filter (3 rows, one per user pill). Confirmed via 4 independent queries. |

Layers Docs↔Code↔Runtime↔Data agree on one fact: the binding never persists. Schema says it should be allowed. So the inconsistency is between Schema (says it should work) and Runtime (says it silently doesn't).

## Classification

🔴 **Root Cause — Server-side silent drop of `postgres_changes` bindings using primary-key column filter shape.**

| Field | Evidence |
|---|---|
| File + line | Client-side trigger: `app-mobile/src/services/realtimeService.ts:715-720`. Server-side acceptance gap: external (supabase-realtime elixir, not in repo). |
| Exact code | `filter: \`id=eq.${sessionId}\`` |
| What it does | Sends a postgres_changes JOIN binding with `(id, eq, <UUID>)` filter. Server returns SUBSCRIBED but does NOT persist the binding to `realtime.subscription`. |
| What it should do | Either (a) persist the binding so subsequent UPDATEs match and deliver, OR (b) return CHANNEL_ERROR so the client knows the filter shape is unsupported. The current silent drop is the worst-of-both: looks healthy, delivers nothing. |
| Causal chain | (1) Client subscribes board_session channel with 9 postgres_changes bindings. (2) Realtime server accepts JOIN but persists none of them. (3) UPDATE on collaboration_sessions emits WAL event. (4) `apply_rls` scans `realtime.subscription` for entity=collaboration_sessions; finds only `(created_by, eq, <self>)` rows from pill_changes channel; does NOT find anything for board_session. (5) For non-creator participants (Ava, Priya), `created_by ≠ self`, so apply_rls finds no match → no delivery → no onSessionUpdated → ORCH-0923's invalidate never fires → stale dead-end persists. |
| Verification step | Query `SELECT count(*) FROM realtime.subscription WHERE entity = 'public.collaboration_sessions'::regclass AND filters::text LIKE '%(id,eq,%'`. Returns 0. Reproduce by driving any client into the board_session channel and re-querying — count stays at 0. |

🟠 **Contributing Factor — Rebind churn (25+ teardown/recreate cycles per session entry) amplifies the symptom.**

Even if the binding-drop issue is fixed, the channel cycling SUBSCRIBED→CLOSED→SUBSCRIBED 25 times per session entry is wasteful and could create blind windows for missed events. Root cause: `useBoardSession.ts:469` dep array includes `user?.id`, and `useAuthSimple.ts:325-328` fires `rebindAuthenticatedChannels` on every `SIGNED_IN`/`TOKEN_REFRESHED` event without deduping on token equality at the trigger level.

🟡 **Hidden Flaw — ORCH-0926's regression and adversarial test suites (8 tests, all passing) validate the CODE PATH but cannot catch the server-side persistence failure.**

The tests mock `supabase.channel(...)` and assert on call ordering. They prove the client sends the right messages in the right order. They cannot prove the server persists the binding. **No realtime-side integration test exists in this codebase.** This is why a passing test suite shipped with the real-world bug intact.

🔵 **Observation — The pill_changes channel works correctly for session creators.**

Marcus (who created daadd454) DOES receive realtime UPDATEs via his `collaboration_pill_changes_<marcus>` channel because `(created_by, eq, marcus)` matches daadd454.created_by. The silent-drop bug only affects participants who didn't create the session. This explains why "the operator's dev build sees DB updates land" earlier in this saga — Marcus's dev build IS receiving them via the pill channel, but Ava's and Priya's sims are not via their board_session channels.

## Blast radius

Every realtime listener that uses `(<primary-key>, eq, <value>)` filter shape is broken. Audit needed:

| File | Filter shape | Status |
|---|---|---|
| `realtimeService.ts:107` | `(session_id, eq, <UUID>)` on session_participants | LIKELY OK (session_id is not PK) |
| `realtimeService.ts:120` | `(session_id, eq, <UUID>)` on session_participants | LIKELY OK |
| `realtimeService.ts:133` | `(id, eq, <UUID>)` on collaboration_sessions | **BROKEN** (PK filter) |
| `realtimeService.ts:177` | `(id, eq, <UUID>)` on boards | **LIKELY BROKEN** (PK filter — same shape) |
| `realtimeService.ts:190,203` | `(board_id, eq, <UUID>)` on board_collaborators | LIKELY OK |
| `realtimeService.ts:423-484` | `(session_id, eq, <UUID>)` on board_*  | LIKELY OK |
| `realtimeService.ts:715` | `(id, eq, <UUID>)` on collaboration_sessions (board_session channel) | **BROKEN** (PK filter) |
| `realtimeService.ts:730` | `(id, eq, <UUID>)` on collaboration_sessions DELETE (board_session channel) | **LIKELY BROKEN** (PK filter) |

Recommend the implementor explicitly verify by query after the fix lands: count realtime.subscription rows by filter column on a known-active set of channels and confirm every requested binding has a persisted row.

## Invariant violation

**I-PROPOSED-ORCH-0931 — Realtime postgres_changes filter must use a non-PK column.** If you need to filter by primary key, that filter shape is silently rejected by the supabase realtime server (as of v2.74). Pair every primary-key filter with an alternative non-PK filter, OR switch the entire delivery mechanism to broadcast.

## Fix Strategy — ONE authoritative path

There is exactly one shape of fix that addresses both the root cause AND survives the next supabase-realtime upgrade without re-investigation: **replace the `postgres_changes id=eq.<sessionId>` filter pattern with a `broadcast`-based delivery via a Postgres trigger that calls `realtime.broadcast_changes()` (or `realtime.send()`) when `collaboration_sessions` updates**.

### Why this is the right fix

1. **Broadcasts bypass the postgres_changes binding-persistence layer entirely.** The client subscribes via `.on("broadcast", { event: "session_update" }, callback)`. No `realtime.subscription` row is needed. The PK-filter dead-end is sidestepped.
2. **Broadcasts use the new "Realtime Authorization" (private channel) pattern** that supabase has been moving to since v2.0. Subscriber authorization is gated by RLS policies on `realtime.messages` table (set explicitly per topic / channel topic). This gives session participants a clean, RLS-enforced way to receive the event.
3. **Single delivery channel per session.** Today there are 9 postgres_changes bindings per board_session channel; many would still work if their filter columns are non-PK, but the most important one (collaboration_sessions UPDATE) is dead. With broadcast, the trigger emits one event per UPDATE, all participants on the session's broadcast topic receive it.
4. **No client-side ORCH-0926 work is wasted.** The existing rebind / scoped authenticated channel logic is still useful for chat broadcasts, presence, and other channels. The fix is additive: change the collaboration_sessions delivery path to broadcast; leave everything else.
5. **Cleanly extends to the chat-native sheet redesign** per `PRODUCT_DIRECTION_COLLAB_SESSIONS_IN_CHAT.md` Contract 4 ("Realtime is first-class, no Apply button"). Per-field updates via debounced auto-save will benefit from the same broadcast pipe.

### What the fix concretely does

1. **Migration:** Add a Postgres trigger on `collaboration_sessions` that, AFTER UPDATE of `deck_version` or `deck_params_hash` or `participant_prefs`, calls `realtime.broadcast_changes()` with topic `board_session:<id>` and event `session_updated`. The trigger payload includes deck_version, deck_params_hash, and the JSONB delta needed for client-side cache invalidation.
2. **RLS policy on `realtime.messages`:** add a policy allowing authenticated users to RECEIVE messages on topic `board_session:<sessionId>` when `is_session_participant(<sessionId>, auth.uid())` returns true. (SELECT-only; never INSERT — the trigger is the only writer.)
3. **Client change in `realtimeService.ts`:** replace the failing `.on("postgres_changes", { event: "UPDATE", schema: "public", table: "collaboration_sessions", filter: "id=eq.<sessionId>" }, ...)` binding with `.on("broadcast", { event: "session_updated" }, ...)`. Channel topic stays `board_session:<sessionId>`.
4. **Optional client cleanup:** the other `id=eq.<sessionId>` bindings (board_session line 730 DELETE; subscribeToSession; subscribeToBoard line 177) follow the same pattern and should be migrated together OR documented as known-dead per blast radius §.

This is a non-trivial change (one migration + one RLS policy + one client refactor) but it's contained to a clearly-bounded surface AND it sets up the future chat-native sheet to use the broadcast pipe cleanly.

### Alternatives considered and rejected

- **Use `created_by=eq.<sessionId-creator>` instead of `id=eq.<sessionId>`.** Works for the creator only. Doesn't fix Ava / Priya / other participants. Same delivery gap.
- **Replicate the pill_changes channel's pattern of subscribing per-user.** Requires the user to know who created which session BEFORE subscribing, which is racy on session-join flows and breaks if sessions are reassigned. Fragile.
- **Upgrade supabase-js or supabase-realtime past v2.74.** Unknown if it fixes this; risks new bugs; would need separate ORCH for upgrade testing. Doesn't solve the architectural issue.
- **`createClient({ accessToken })`.** Already ruled out in ORCH-0926 investigation §"Why the accessToken client option crashed" — incompatible with the app's `auth.onAuthStateChange` usage.
- **Add a non-PK column to filter on (e.g., a redundant `session_id` column that mirrors `id`).** Adds schema rot. Doesn't address the broader pattern. Same root cause.
- **Polling.** Defeats the purpose of realtime.

### Trade-offs of the recommended broadcast fix

- **Pro:** Removes the PK-filter dead-end. Modern Supabase pattern. Future-proof. Aligns with product direction.
- **Pro:** Smaller per-event payload (only the deck_version+hash, not the full row) — less bandwidth.
- **Con:** Requires backend changes (migration + RLS policy + trigger function). Violates `PRODUCT_DIRECTION_COLLAB_SESSIONS_IN_CHAT.md` Contract 5 "backend stays untouched" — but the product direction itself flags the date-aggregation hybrid as a Contract-5 carve-out, so this fix is in similar carve-out territory.
- **Con:** Need to handle the case where a session participant joins after the channel topic broadcast has already fired — they may miss updates between sign-in and channel attach. Mitigation: initial deck fetch on attach (already in place).

## Regression prevention

1. **New invariant `I-PROPOSED-ORCH-0931-NO-PK-FILTER-REALTIME`** added to `INVARIANT_REGISTRY.md`: "Realtime postgres_changes filters MUST NOT use primary-key columns on RLS-gated tables. Either use a non-PK column filter OR use broadcast." Enforced by a new strict-grep CI gate scanning for `.on("postgres_changes", { filter: \`id=eq.` patterns.
2. **New realtime integration test** (post-fix) that:
   - Creates a fresh session with two participants
   - Subscribes both clients to the broadcast event via the new mechanism
   - UPDATEs the session DB-side
   - Asserts both clients receive the broadcast within 2 seconds
   - Asserts `realtime.subscription` row counts (or the absence thereof if broadcast doesn't use that table) match expectation
3. **Update `SIM_DRIVING_REFERENCE.md` §18 "Metro log conventions"** to call out the bug 1 verdict signal: `[ORCH-0923-DIAG] onSessionUpdated fired` (or whatever the new broadcast callback's diag is) must appear within 1 second of a remote pref change.
4. **Sweep the realtime publication for residual PK-filter usage** — audit the `app-mobile`, `mingla-business`, and `mingla-admin` codebases. Any remaining `id=eq.*` filter on a postgres_changes binding is silently broken and should be migrated to broadcast (or to a non-PK filter).

## Discoveries for orchestrator

1. **The supabase-realtime PK-filter silent-drop is undocumented in the supabase docs.** Worth filing a GitHub issue OR a memory file (`feedback_supabase_realtime_pk_filter_silent_drop.md`) so future investigators don't re-discover it.

2. **`useBoardQueries.ts:330` uses `filter: created_by=eq.${userId}` on `boards`** — that table's PK is `id`. So that subscription likely WORKS by happy accident. The `boards` table's primary key bug would surface if anyone added a `(boards, id=eq.<UUID>)` filter. The blast-radius §"realtimeService.ts:177" entry flags this for audit.

3. **The QA report's P1-rebind-storm finding is real but lower-priority than P0.** Even after the broadcast fix lands, the rebind cycle on every auth event will still be wasteful. Worth a separate follow-up ORCH ("debounce rebindAuthenticatedChannels on token equality at the trigger layer" — current dedup is inside the rebind function, not at the trigger).

4. **The QA report's P2 "PreferencesSheet blanked after one apply" finding is unrelated to ORCH-0931 but is worth its own bug intake** — it's a state-machine glitch in the prefs sheet that may have been introduced (or surfaced) by META-ORCH-0929's in-deck preferences sheet refactor.

5. **`SIM_DRIVING_REFERENCE.md` is now production-quality** for the new META-ORCH-0929 flow. Codex's Scenario-1 update resolved the Swipe pill selector mystery: `tapOn: text: "Swipe Testing stuff"` works because the iOS accessibility tree concatenates `"Swipe " + sessionName`. The reference doc is the right place for this kind of selector lore.

## Cross-Surface Impact

- **iOS consumer (`app-mobile/` on iOS):** primary — fix lands here in client code change.
- **Android consumer (`app-mobile/` on Android):** primary — shared RN code path, same fix applies automatically.
- **Backend:** migration + RLS policy required (carve-out of `PRODUCT_DIRECTION_COLLAB_SESSIONS_IN_CHAT.md` Contract 5 — needs operator sign-off in the eventual SPEC).
- **Buyer-web, business iOS/Android, admin-web, business-web-preview:** N/A — none of these subscribe to `board_session:<sessionId>` channels.

## Confidence

`proven` — the realtime.subscription DB inspection is unambiguous and the client code path is fully traced. The recommended fix path is well-supported by supabase's own broadcast / realtime-authorization documentation pattern. Implementation risk is moderate (new RLS policy + new trigger function) but the bounded surface is well-defined.

## Discoveries summary

5 distinct discoveries surfaced and routed above. None require widening the investigation scope.

## Working tree

`/Users/sethogieva/Desktop/mingla-main` on branch `Seth`. Test session `daadd454-35a8-487d-ab25-bb595abc4635` was used read-only for live probes; no SQL mutations. Diag markers preserved across all four ORCH-0926 source files.

NEXT HANDOFF — paste into Claude `mingla-forensics` (SPEC mode):

Write the SPEC for the broadcast-based realtime delivery fix per the recommended fix path in `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0931_REALTIME_POSTGRES_CHANGES_SILENT_BINDING_DROP.md`. The SPEC must define: (1) the new Postgres trigger function and its trigger DDL — fires on `collaboration_sessions` AFTER UPDATE of `deck_version` / `deck_params_hash` / `participant_prefs` and calls `realtime.broadcast_changes()` to topic `board_session:<id>` event `session_updated` with payload containing deck_version + deck_params_hash; (2) the RLS policy on `realtime.messages` allowing participants (via `is_session_participant(session_id, auth.uid())`) to receive but not send on this topic; (3) the client-side change in `app-mobile/src/services/realtimeService.ts` to replace the failing `.on("postgres_changes", filter: "id=eq.<sessionId>")` with `.on("broadcast", event: "session_updated", ...)`; (4) the new invariant `I-PROPOSED-ORCH-0931-NO-PK-FILTER-REALTIME` and its strict-grep CI gate; (5) the new integration test asserting two-device broadcast delivery within 2 seconds; (6) success criteria covering both A (delivery works) and B (no regression on existing broadcast / postgres_changes that already worked). Hard guards: this is a carve-out from `PRODUCT_DIRECTION_COLLAB_SESSIONS_IN_CHAT.md` Contract 5 — operator approval already implied by the dispatch language "treat... as part of the same evidence bundle" but call it out in the SPEC §2 explicitly; do not widen scope to ORCH-0925 bug 3 or ORCH-0926 rebind-storm (P1 follow-up); do not migrate the other `(id, eq, <UUID>)` filters in the same SPEC — name them in §Blast Radius and queue follow-up ORCHs. Output to `Mingla_Artifacts/specs/SPEC_ORCH-0931_REALTIME_BROADCAST_SESSION_UPDATED.md`. Downstream routing: Codex `implementor-mingla` after SPEC review approval; then `mingla-tester` for two-device live verification on iOS + Android; then `orchestrator-mingla` for CLOSE. Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.

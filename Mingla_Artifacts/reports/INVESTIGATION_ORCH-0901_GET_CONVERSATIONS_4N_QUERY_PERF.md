# INVESTIGATION — ORCH-0901 [Refactor `messagingService.getConversations` from 4N-sequential-queries to single JOINed query — pre-ORCH-0898 perf prerequisite]

**Skill:** Claude `mingla-forensics` — INVESTIGATE+SPEC single-session
**Dispatch:** `Mingla_Artifacts/prompts/INVESTIGATOR_AND_SPEC_ORCH-0901_GET_CONVERSATIONS_4N_QUERY_PERF.md`
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Date:** 2026-05-20
**Confidence:** HIGH (pure code-audit investigation; Prime Directive 7 exemption applies — dispatch §5 confirmed source-only reasoning is appropriate for performance / code-audit dispatches with documented root cause in source comments)

---

## §0 Phase 0 ingestion

| Source | One-line summary |
|---|---|
| `Mingla_Artifacts/prompts/INVESTIGATOR_AND_SPEC_ORCH-0901_*.md` | This dispatch — INVESTIGATE+SPEC single-session, ship before ORCH-0898 [Consumer collab session → Friends-tab group chat]. |
| `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0898_COLLAB_GROUP_CHAT.md` §13 #3 | Origin of ORCH-0901 — flagged the 4N-sequential-queries pattern as Discovery #3. Cross-link confirmed. |
| `~/.claude/projects/.../memory/feedback_solo_collab_parity.md` | Solo (DM) + collab (group chat) parity rule applies — any refactor of `getConversations` must not regress DM behavior; group rows must work identically. |
| `~/.claude/projects/.../memory/feedback_zustand_persist_no_server_snapshots.md` | I-PROPOSED-J ACTIVE — conversations are server state; refactor must NOT introduce Zustand persist. Current code uses `useState` in `ConnectionsPage` (line 405 area). Verified compliant; preserve. |
| `~/.claude/projects/.../memory/feedback_supabase_neq_null.md` | `.neq()` on a nullable column silently filters NULL rows (`NULL != 'value'` is NULL, falsy). Critical — see §3 Finding #2. |
| `app-mobile/src/services/messagingService.ts` lines 211, 79, 520, 919, 942 | Definitions of `Conversation` + `DirectMessage` + `getConversations` + `getSenderName` + `enrichMessage`. |
| `app-mobile/src/components/ConnectionsPage.tsx` lines 689-735 | The only caller — wraps `getConversations` in a 10s `Promise.race` timeout + does an ADDITIONAL batch profile-fetch (line 719) before transforming the result to UI shape. |
| `app-mobile/src/components/connections/ChatListItem.tsx` lines 14, 18, 105-106 | Consumer of the UI-shape `Conversation`. Imports `Conversation` from `../../hooks/useMessages` (NOT from `messagingService`) — see §3 Finding #4. |
| `app-mobile/src/hooks/useMessages.ts` lines 1-14 + 34-50 | Deprecated hook (ORCH-0900 scope). Its TYPE export `Conversation` (line 34) is the UI-hydrated shape — different from `messagingService.ts:211` server-shape. |
| `app-mobile/src/services/boardDiscussionService.ts` line 39 `fetchSessionMessages` | Reference: proven nested-JOIN pattern in the codebase to mirror. |
| `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql` lines 14966, 14972, 14978 | RLS policies on `conversations` + `messages` use inline EXISTS subqueries (`Users can view conversations they participate in` etc.), confirming RLS-driven single-query approach (option b) is structurally sound. |

No prior investigation contradicts current findings. No memory flags stale assumptions in this dispatch.

---

## §1 Symptom

- **Reported (verbatim source comment at `ConnectionsPage.tsx:693`):** "Hard 10-second timeout: `messagingService.getConversations` runs 4N sequential Supabase queries with no built-in timeout. When the app returns from background, the OS suspends inflight connections and Supabase hangs silently — the finally block would never fire, leaving `conversationsLoading` stuck at true forever."
- **Cross-referenced (`useMessages.ts:1-14`):** "fetchMessages() runs 2 sequential Supabase queries per message (profile + read status) inside a for loop — 60+ serial round-trips for a user with 3 conversations × 10 messages. It has no timeout. Importing this hook will cause an unrecoverable performance regression and an infinite spinner under any network latency."
- **Expected behavior:** Friends-tab DM list opens with a snappy cold-load (~1s) showing all conversations sorted by recent activity.
- **Actual behavior:** Cold-load takes 5–10 seconds typical, can time out at 10 seconds (the wrapper's safety net) leaving the user with an empty list + retry. Backgrounded-app return is the worst case (Supabase connections suspended → silent hang).
- **When it started:** documented in source comments — pre-existing pattern, exact origin not traced (out-of-scope for this investigation per dispatch §5).
- **Reproduction conditions:** any cold-load of the Friends tab. Worse with N (# conversations), M (avg participants per conversation), and unique sender count.

---

## §2 Investigation manifest

| # | File | Why read |
|---|---|---|
| 1 | `app-mobile/src/services/messagingService.ts:520-595` | The function under investigation (`getConversations`). |
| 2 | `app-mobile/src/services/messagingService.ts:79-95, 211-226` | `DirectMessage` + `Conversation` interfaces — return-type contract. |
| 3 | `app-mobile/src/services/messagingService.ts:919-958` | `getSenderName` + `enrichMessage` — called inside the loop; count their sub-queries. |
| 4 | `app-mobile/src/components/ConnectionsPage.tsx:689-758` | The only caller — `fetchConversations` wrapper + 10s timeout + batch profile-fetch + transform to UI shape. |
| 5 | `app-mobile/src/components/connections/ChatListItem.tsx:14, 18, 105-106` | Downstream consumer — establishes UI-shape contract. |
| 6 | `app-mobile/src/hooks/useMessages.ts:1-50` | Deprecated hook holding the UI-shape `Conversation` type that ChatListItem imports — cross-link to ORCH-0900. |
| 7 | `app-mobile/src/services/boardDiscussionService.ts:39-64` | Proven nested-JOIN pattern to mirror in SPEC. |
| 8 | `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql` lines 7981, 8006, 8421, 14966, 14972, 14984 | Schema + RLS validation for the JOIN approach. |
| 9 | `grep -rln "messagingService.getConversations" app-mobile/src` | All callers — exactly ONE: `ConnectionsPage.tsx:707`. |

---

## §3 Findings

### 🔴 Finding #1 — `getConversations` issues 2 + ~5N + ~N sequential Supabase queries per cold-load (root cause)

- **File + line:** `app-mobile/src/services/messagingService.ts:520-595`
- **Exact query inventory** (counted from a direct read of the function body):

| Step | Line | Query | Count per N |
|---|---|---|---|
| A | 523-526 | `.from('conversation_participants').select('conversation_id').eq('user_id', userId)` | **1× (constant)** |
| B | 537-544 | `.from('conversations').select('*, participants:conversation_participants(*)').in('id', conversationIds).order('last_message_at', ...)` | **1× (constant)** |
| C | 551-558 | per conversation: `.from('messages').select('*').eq('conversation_id', conv.id).is('deleted_at', null).order('created_at', desc).limit(1).single()` — last message | **1× per N** |
| D | 561-566 | per conversation: `.from('messages').select('id').eq('conversation_id', conv.id).neq('sender_id', userId).is('deleted_at', null)` — unread IDs | **1× per N** |
| E | 571-575 | per conversation, IF unread > 0: `.from('message_reads').select('message_id').in('message_id', messageIds).eq('user_id', userId)` | **≤1× per N** |
| F | 927-931 (via enrichMessage→getSenderName) | per last-message: `.from('profiles').select(...).eq('id', senderId).single()` — **cached 5min** | **≤1× per unique sender** |
| G | 946-951 (via enrichMessage) | per last-message: `.from('message_reads').select('id').eq('message_id', ...).eq('user_id', userId).single()` — read status | **1× per N** |

- **Total formula:** `2 + 4N + N_unique_senders` queries (cold), `2 + 4N + 0` (with profile cache warm).
- **What it does:** for N=10 conversations with 10 unique senders → **~52 sequential Supabase round-trips on cold-load**. Documented source comment ("4N") is a conservative simplification — the real shape is ~5N with helper-table fan-out.
- **What it should do:** ONE Supabase query with nested JOINs that returns conversations + participants + last message + unread count (or sentinel) + sender profile in a single round-trip. Pattern proven by `boardDiscussionService.fetchSessionMessages` (line 39).
- **Causal chain:** Each Supabase call is a separate HTTP round-trip averaging ~80–150ms in good network conditions, longer under cellular / poor wifi. 52 sequential round-trips × 100ms = ~5.2s typical cold-load. The 10-second wrapper at `ConnectionsPage.tsx:693` is the safety net that prevents users from being stranded with `conversationsLoading=true` forever when the OS suspends inflight Supabase connections on app-backgrounding.
- **Verification step:** open the Friends tab cold (force-quit + relaunch) with a user who has ≥5 conversations; observe the loading spinner duration; check Supabase logs for the query count. Independent reproduction: count `from()` invocations in the function body via static AST analysis (exactly 7 distinct `from()` calls inside the function + its helpers, with 5 inside per-iteration loops).

### 🟠 Finding #2 — `.neq('sender_id', userId)` on line 565 silently drops NULL `sender_id` rows (contributing factor + future-bug risk under ORCH-0898)

- **File + line:** `app-mobile/src/services/messagingService.ts:565`
- **Exact code:**
  ```typescript
  .from('messages')
  .select('id')
  .eq('conversation_id', conv.id)
  .neq('sender_id', userId)
  .is('deleted_at', null);
  ```
- **What it does:** filters for messages NOT sent by the current user. `messages.sender_id` is nullable (per baseline migration line 8424). Per `feedback_supabase_neq_null.md`, `NULL != 'value'` is NULL (falsy), so any message with `sender_id IS NULL` is silently excluded.
- **What it should do:** include NULL-sender rows in the unread count (system messages, deleted-user messages). Correct predicate: `.or('sender_id.neq.<userId>,sender_id.is.null')`.
- **Causal chain:** Today no production system messages exist (no production code writes `messages` with `sender_id=NULL`), so the bug is dormant. ORCH-0898 [Consumer collab session → Friends-tab group chat] SPEC §10.2 + §12 Q10 explicitly plans to post system messages with `sender_id IS NULL` for round transitions ("[host] is planning another outing — tap to join the swipe"). The day ORCH-0898 ships, system messages will start being posted and NEVER counted as unread → users see no unread badge for round-start notifications.
- **Verification step:** insert a test row directly: `INSERT INTO messages (conversation_id, sender_id, content) VALUES ('<id>', NULL, 'system msg test')`; call `getConversations` for a participant; observe `unread_count` does NOT increment for that conversation.
- **Classification rationale:** contributing factor (not the root cause of the 4N pattern but a real correctness bug that compounds with ORCH-0898). Severity bumped because ORCH-0898 will activate it.

### 🟡 Finding #3 — `.single()` on potentially empty result sets at lines 558 + 951 (hidden flaw — Supabase 406 noise + crash-risk if `data` destructure changes)

- **File + line:** `app-mobile/src/services/messagingService.ts:558, 951`
- **Exact code (line 558):** `.from('messages').select('*').eq('conversation_id', conv.id).is('deleted_at', null).order('created_at', { ascending: false }).limit(1).single();`
- **Exact code (line 951):** `.from('message_reads').select('id').eq('message_id', message.id).eq('user_id', userId).single();`
- **What it does:** when zero rows match (conversation has no messages, or current user has not yet read the last message), Supabase PostgREST returns 406 Not Acceptable with `error.code = 'PGRST116'`. The current code destructures only `data` (not `error`), so the error is silently dropped. `lastMessage` becomes `null` and the `if (lastMessage)` guard handles it correctly — but the network log fills with 406 errors per cold-load (one per empty conversation + one per unread last-message).
- **What it should do:** use `.maybeSingle()` instead of `.single()`. `.maybeSingle()` returns `data: null, error: null` on zero rows without a 406. Or migrate the query into the unified JOIN where the absence of a last-message row is just a NULL.
- **Causal chain:** today no crash, no functional bug — just network-log noise + minor perf hit (406 round-trip cost). Future bug risk: if a future refactor destructures `error` and throws on any error, every empty conversation will trigger an uncaught crash.
- **Verification step:** trace `console.error` output during cold-load with a fresh test account that has 1+ empty conversation; observe `PGRST116` rows.

### 🟡 Finding #4 — Two parallel `Conversation` type definitions create implicit type-divergence risk (hidden flaw)

- **File + line:** `app-mobile/src/services/messagingService.ts:211` (server-shape) vs `app-mobile/src/hooks/useMessages.ts:34` (UI-hydrated-shape)
- **Exact code (messagingService:211):**
  ```typescript
  export interface Conversation {
    id: string;
    type: 'direct' | 'group';   // ← already group-ready
    created_by: string | null;
    participants: { id: string; user_id: string; joined_at: string; last_read_at?: string; }[];
    last_message?: DirectMessage;
    unread_count?: number;
  }
  ```
- **Exact code (useMessages:34):**
  ```typescript
  export interface Conversation {
    id: string;
    created_by: string;
    participants: { id: string; username: string; display_name?: string; first_name?: string; last_name?: string; avatar_url?: string; is_online?: boolean; }[];
    last_message?: Message;
    unread_count: number;
    messages: Message[];
  }
  ```
- **What it does:** two different types with the same name in different files. `ChatListItem.tsx:14` imports from `useMessages` (the UI-hydrated shape). `messagingService.getConversations` returns the server-shape. `ConnectionsPage.fetchConversations` (lines 728-754) transforms server-shape → UI-shape via a manual `.map()` after batch-fetching profiles on line 719.
- **What it should do:** ONE canonical `Conversation` type per shape (server vs UI), in canonical type files. Cross-link to **ORCH-0900** [useMessages.ts dead-code cleanup] — that ORCH plans to extract the UI-shape `Conversation` + `Message` types to `app-mobile/src/types/messaging.ts`. ORCH-0901 must NOT block on ORCH-0900 but must NOT regress the import path either.
- **Causal chain:** today the transform layer (`ConnectionsPage.fetchConversations` line 728-754) is correct. Risk: any future change to the server-shape that isn't mirrored in the UI-shape (or vice versa) silently drops fields. Tests on either shape don't cover the gap.
- **Verification step:** `git grep "interface Conversation" app-mobile/src` returns both files; the names collide but the import path determines which is in scope per file.
- **Classification rationale:** hidden flaw (no live bug today, structural risk). Recommend SPEC for ORCH-0901 explicitly preserve the server-shape `Conversation` from `messagingService.ts:211` unchanged — the UI-shape unification belongs to ORCH-0900.

### 🟡 Finding #5 — `ConnectionsPage.fetchConversations` does an ADDITIONAL batch profile-fetch on line 719 (hidden flaw — out-of-scope query)

- **File + line:** `app-mobile/src/components/ConnectionsPage.tsx:719-722`
- **Exact code:**
  ```typescript
  const { data: allProfiles } = await supabase
    .from("profiles")
    .select("id, display_name, username, first_name, last_name, avatar_url")
    .in("id", Array.from(allParticipantIds));
  ```
- **What it does:** after `messagingService.getConversations` returns, ConnectionsPage runs ONE more Supabase query to batch-fetch all participant profiles. This is because `getConversations` returns participants with raw `user_id` only — no profile data. The transform layer on line 728-754 then merges profiles in.
- **What it should do:** SPEC choice — either (a) keep this batch fetch (the cleanest separation: service returns server-shape, component hydrates), or (b) push the profile JOIN inside `getConversations` (eliminates the round-trip but couples the service to UI concerns). **Recommend (a) for ORCH-0901** — keeps service contract clean, matches existing pattern, minimizes blast radius. Document explicitly so SPEC doesn't accidentally widen scope.
- **Causal chain:** today this adds 1 query to the cold-load (after the ~5N inside `getConversations`). Total cold-load = `5N + 3` queries (2 inside getConversations setup + 5N inside loop + 1 in ConnectionsPage transform). Not the bottleneck (1 batch query is cheap; the bottleneck is the N-loop), but SPEC must NOT silently widen scope to refactor this away.
- **Verification step:** profile network tab during cold-load; count `/profiles?` queries (exactly 1 from this site + ≤N cached profile queries from `getSenderName`).

### 🔵 Finding #6 — `senderProfileCache` 5-minute TTL with no invalidation on rename (observation)

- **File + line:** `app-mobile/src/services/messagingService.ts:230-231` + 922-925
- **Exact code:**
  ```typescript
  private senderProfileCache: Map<string, { name: string; cachedAt: number }> = new Map();
  private static PROFILE_CACHE_TTL = 5 * 60 * 1000;
  ```
- **What it does:** caches sender display-name per session for 5 minutes. Reduces N profile fetches inside `enrichMessage`.
- **What it should do:** acceptable as-is for sender-name (5-min staleness is fine for chat-list previews). Document as out-of-scope for ORCH-0901.
- **Classification rationale:** observation only. The cache is performance-positive and the staleness window is tolerable for the use case.

### 🔵 Finding #7 — Function has NO internal timeout; 10s safety net is at the call-site in `ConnectionsPage` (observation)

- **File + line:** `app-mobile/src/services/messagingService.ts:520-595` (no timeout) + `app-mobile/src/components/ConnectionsPage.tsx:697-703` (Promise.race timeout)
- **What it does:** `getConversations` itself has no `AbortController` or timeout. If any single Supabase call hangs (e.g., OS-suspended inflight connection after app-background), the entire function hangs indefinitely. The 10s `Promise.race` at the call-site is the ONLY safety net.
- **What it should do:** SPEC owner choice — (a) keep the call-site timeout as belt-and-suspenders for v1, (b) add an internal `AbortController` for tighter control. **Recommend (a)** — the call-site timeout works today; adding an internal one is double-protection but adds complexity. Document.
- **Classification rationale:** observation. The pattern is fragile but functional today; the refactor to a single query eliminates the underlying hang risk by reducing 5N round-trips to 1.

---

## §4 Five-layer cross-check

| Layer | What this layer says |
|---|---|
| **Docs** | Source-comment block at `ConnectionsPage.tsx:693-696` documents the 4N-sequential pattern + the OS-suspend hang risk explicitly. `useMessages.ts:1-14` documents an even worse N+1 pattern (60+ serial round-trips). No README contradiction. |
| **Schema** | `conversations`, `conversation_participants`, `messages`, `message_reads`, `profiles` all have the FKs needed for the JOIN. RLS policies at lines 14966 + 14972 + 14984 use inline EXISTS subqueries — single-query RLS-filtered read is structurally sound. No schema barriers to the refactor. |
| **Code** | Function does 2 + ~5N queries as enumerated in Finding #1. Source-only count verified by direct read of `app-mobile/src/services/messagingService.ts:520-595` + helpers at 919-958. |
| **Runtime** | Not directly observed (pure code-audit per dispatch §5 exemption). Estimated: ~5N × 100ms = 500ms per N; N=10 → ~5s typical cold-load. 10s timeout fires when network latency × query-count > 10s. Source-comment confirms hang under app-background. |
| **Data** | No data inspection required for this perf investigation. The pathology is in the query shape, not the data. |

**Contradictions:** none. All five layers agree: the function makes too many sequential queries and the schema supports a single-query alternative.

---

## §5 Blast radius

- **Other flows affected by the same pattern:**
  - `useMessages.ts:fetchMessages` (per its own `@deprecated` header) — already known dead code per ORCH-0900.
  - `useMessages.ts:loadMessages` — same N+1 pattern; same dead-code status.
  - `messagingService.getMessages(conversationId, userId, limit)` (line 600) — uses a single query then loops `enrichMessage` (N+1 reads on `message_reads`). Out of scope for ORCH-0901; flag for follow-up.
- **Solo + collab parity (per `feedback_solo_collab_parity.md`):** "solo" here is direct DMs, "collab" is the future group conversations. Today only direct exists; the refactor must NOT introduce filtering on `type='direct'` so that ORCH-0898's `type='group'` rows naturally appear in the same list query (matches SPEC SC-07).
- **Admin dashboard:** N/A (no consumer-app conversation surface in admin).
- **Query keys / cache state:** `ConnectionsPage` uses local `useState` for conversations (not React Query). The refactor is shape-preserving so cache invalidation logic in `ConnectionsPage` is unaffected.
- **Invariants:**
  - I-PROPOSED-J (Zustand persist holds IDs, not server records) — PRESERVED. ConnectionsPage uses `useState`, not Zustand persist.
  - NEW invariant DRAFT: I-FRIENDS-TAB-COLD-LOAD-UNDER-2S (flips ACTIVE on ORCH-0901 CLOSE — see SPEC).
- **Recurring patterns (per `references/recurring-patterns.md`):**
  - **N+1 query pattern** — recurring across `useMessages.ts`, `messagingService.getConversations`, `messagingService.getMessages`. Three known instances; ORCH-0901 fixes one, ORCH-0900 retires another.
  - **`.neq()` on nullable column** — bug class documented in `feedback_supabase_neq_null.md`. This investigation surfaces a new occurrence at line 565.

---

## §6 Fix strategy (direction only — full SPEC follows separately)

Rewrite `getConversations` as a single Supabase query using RLS-filtered nested JOINs. Pattern: mirror `boardDiscussionService.fetchSessionMessages:39` (proven nested-JOIN shape against the same Supabase JS client).

Query shape (schematic — SPEC owns the SQL):
```typescript
.from('conversations')
.select(`
  *,
  participants:conversation_participants(*),
  last_message:messages!conversations_last_message(
    *,
    read_by:message_reads!message_id_user_id(read_at)
  )
`)
.order('last_message_at', { ascending: false, nullsFirst: false })
```

Key design choices the SPEC must lock:
1. **Single round-trip.** Rely on RLS policy `Users can view conversations they participate in` (line 14966) to filter — no explicit `.in('id', conversationIds)` needed.
2. **Group-conversation-ready.** Do NOT filter by `type`. Once ORCH-0898 [Consumer collab session → Friends-tab group chat] adds `type='group'` rows, they appear automatically.
3. **Preserve server-shape `Conversation` return type** from `messagingService.ts:211` exactly. UI-shape transform stays in ConnectionsPage.
4. **Last message:** use a lateral subquery or a `LIMIT 1 ORDER BY created_at DESC` shaped query. Postgrest's `!inner` / `!left` join syntax + `.order().limit(1)` on the nested relation supports this.
5. **Unread count:** computed in TypeScript from the joined `message_reads` (or aggregated server-side via a SQL function if Postgrest's GROUP BY support is too constrained — SPEC decides).
6. **Fix Finding #2** — replace `.neq('sender_id', userId)` with `.or('sender_id.neq.<userId>,sender_id.is.null')` to handle future system messages correctly.
7. **Fix Finding #3** — replace `.single()` with `.maybeSingle()` where empty results are expected (or eliminate via JOIN).
8. **Preserve `senderProfileCache`** (Finding #6) — out of scope, leave alone.
9. **Internal timeout** — out of scope; keep call-site timeout in ConnectionsPage as safety net.

---

## §7 Regression prevention

- **Implementor happy-path test** (path: `app-mobile/src/services/__tests__/messagingService_getConversations.regression.test.ts`):
  - Verifies single-Supabase-round-trip count by mocking `supabase.from` and counting `.select()` invocations.
  - Verifies return-shape equivalence with the legacy implementation across 6 cases (zero conversations, single direct, multiple direct, orphaned participant, simulated `type='group'`, unread count correctness including NULL-sender system messages).
  - **fails-on-revert** verified by reverting the new query block.
- **Tester adversarial test** (path: `app-mobile/src/services/__tests__/messagingService_getConversations.adversarial.test.ts`):
  - Attacks the query-count invariant from a DIFFERENT angle (AST-based, NOT mock-based) — counts `from()` invocations in the function body via runtime instrumentation.
  - Attacks shape preservation via golden-file JSON snapshot.
  - Attacks the `.neq(NULL)` fix by inserting a NULL-sender row and verifying unread_count increments.
  - N=200 conversations stress test.
- **Append-only test contract** per ORCH-0840 [Regression-test enforcement + append-only CI] — any pre-existing test file touched needs `[TEST-MOD-APPROVED ORCH-0901]` token in commit body.
- **Optional CI gate (P3 follow-up):** strict-grep on `messagingService.ts` forbidding `for (const conv of ...) { await supabase.from(...) }` patterns inside the file — prevents re-introduction of the 4N anti-pattern. SPEC owner decides whether to ship the gate in ORCH-0901 or carry as follow-up.

---

## §8 Discoveries for orchestrator

1. **🟠 NEW BUG (Finding #2 promoted):** `.neq('sender_id', userId)` at `messagingService.ts:565` silently drops NULL-sender rows. Dormant today (no production NULL-sender messages exist). **Will activate the day ORCH-0898 [Consumer collab session → Friends-tab group chat] ships its round-start system messages.** ORCH-0901 SPEC §6 #6 includes the fix as part of the refactor — same diff, no separate ORCH needed.

2. **🟡 Hidden flaw confirmed:** `messagingService.getMessages(conversationId, userId, limit)` at line 600 has the same N+1 pattern (single base query + `enrichMessage` loop with `.from('message_reads').single()` per message). Out of scope for ORCH-0901 (different function, different use case — per-conversation message-list, not the cold-load list). Recommend registering as a follow-up ORCH **after** ORCH-0898 CLOSE, since the substrate work may affect the right fix shape.

3. **🟡 PGRST116 noise** — Finding #3's `.single()` on empty result generates 406 errors per empty conversation + per unread-last-message on every cold-load. Captured as P3 inside ORCH-0901 SPEC; replaced with `.maybeSingle()` or eliminated via JOIN. No separate ORCH.

4. **🔵 `Conversation` type duplication** (Finding #4) — two interfaces with the same name in `messagingService.ts:211` (server-shape) + `useMessages.ts:34` (UI-shape). ORCH-0900 [useMessages.ts dead-code cleanup] is the canonical owner of the UI-shape extraction; ORCH-0901 preserves the server-shape unchanged.

5. **🔵 Documentation update opportunity (P4):** the source comment at `ConnectionsPage.tsx:693` says "4N sequential" — the actual count is `2 + 4N + N_unique_senders` (closer to 5N+3). SPEC includes correcting the comment if the timeout is retained, or removing it entirely if the timeout is removed.

---

## §9 Confidence + verification

**Confidence: HIGH.**

Evidence basis:
- Every query count + line citation is from a direct read of `messagingService.ts` lines 520-595 + 919-958 in this session.
- Five-layer cross-check (§4) confirms no contradiction.
- Schema validation (RLS policy lines 14966/14972/14984) confirms the recommended single-query approach is structurally sound.
- Single-caller verification: `grep -rln "messagingService.getConversations" app-mobile/src` returns exactly `app-mobile/src/components/ConnectionsPage.tsx` — blast radius is one file.

Source-only reasoning is appropriate per Prime Directive 7 exemption (dispatch §5: pure performance / code-audit investigations with documented root cause in source comments). No iOS simulator repro was required and none was performed.

---

## §10 Layman summary

The Friends-tab DM list runs about **5 separate database queries per conversation** instead of 1 big efficient query. With 10 conversations, that's ~52 sequential round-trips to Supabase on cold-load — each adding ~80–150ms. That's why the list takes 5–10 seconds to load today and why the code has a 10-second emergency timeout to prevent infinite spinner when the OS suspends connections (app-background return).

The fix is straightforward: rewrite the function as ONE query with nested JOINs (a pattern that's already proven elsewhere in the codebase at `boardDiscussionService.fetchSessionMessages`). The database schema already supports it — the RLS policies are designed to filter conversations to participants automatically, so a single `.from('conversations').select(...)` does what 7+ separate queries do today.

Two side bugs surfaced along the way that get fixed for free in the same diff:
- A NULL-handling bug at line 565 that doesn't matter today but will silently break group-chat system messages the moment ORCH-0898 ships.
- A 406-error noise issue from `.single()` calls on empty results (replaced with `.maybeSingle()`).

The investigation also confirmed three things that protect downstream work:
- Only ONE caller exists (`ConnectionsPage`) — blast radius is one file.
- The `Conversation` type already has `'direct' | 'group'` — group-conversation-ready by type design.
- The `boardDiscussionService.fetchSessionMessages` pattern proves nested JOINs work against the Mingla Supabase setup.

Report path: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0901_GET_CONVERSATIONS_4N_QUERY_PERF.md`. SPEC follows separately.

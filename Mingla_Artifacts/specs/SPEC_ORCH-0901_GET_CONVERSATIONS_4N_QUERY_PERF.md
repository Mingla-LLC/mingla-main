# SPEC — ORCH-0901 [Refactor `messagingService.getConversations` from 4N-sequential-queries to single JOINed query — pre-ORCH-0898 perf prerequisite]

**Skill:** Claude `mingla-forensics` — SPEC mode (follow-on to INVESTIGATE single-session)
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0901_GET_CONVERSATIONS_4N_QUERY_PERF.md`
**Dispatch:** `Mingla_Artifacts/prompts/INVESTIGATOR_AND_SPEC_ORCH-0901_GET_CONVERSATIONS_4N_QUERY_PERF.md`
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Date:** 2026-05-20

---

## §1 Scope and non-goals

### §1.1 Scope (exhaustive)

1. **Rewrite `app-mobile/src/services/messagingService.ts` `getConversations(userId)` (lines 520–595)** from the 2+5N-sequential-query pattern to a single RLS-filtered Supabase query with nested JOINs. Pattern mirrors `app-mobile/src/services/boardDiscussionService.ts:39 fetchSessionMessages`.
2. **Preserve the server-shape `Conversation` return-type** at `messagingService.ts:211` EXACTLY (lines 211–226 in current source). No type changes. No new fields. Compile-time enforced by TypeScript strict.
3. **Fix Finding #2 — NULL-sender unread bug:** replace `.neq('sender_id', userId)` with `.or('sender_id.neq.<userId>,sender_id.is.null')` so that system messages with `sender_id IS NULL` are correctly counted as unread. This is a structural fix that activates the moment ORCH-0898 [Consumer collab session → Friends-tab group chat] ships its round-start system messages.
4. **Fix Finding #3 — PGRST116 noise:** replace `.single()` with `.maybeSingle()` on the last-message subselect AND on the read-status subselect inside `enrichMessage`. Or eliminate via the JOIN.
5. **Preserve all other existing behavior of `getConversations`:**
   - The `senderProfileCache` 5-min TTL stays untouched (Finding #6 — observation only).
   - The function signature `(userId: string) => Promise<{ conversations: Conversation[]; error: string | null }>` is byte-identical.
   - Error contract unchanged: throw inside try, catch and return `{ conversations: [], error: error.message }`.
   - Sort order: `last_message_at` descending, `nulls last`.
6. **Group-conversation-ready:** the new query MUST NOT filter on `conversations.type`. When ORCH-0898 introduces `type='group'` rows, they appear in the list automatically. The server-shape `Conversation` already has `type: 'direct' | 'group'` at `messagingService.ts:213`.
7. **Update the inline comment at `ConnectionsPage.tsx:693-696`** to reflect the new query count ("1 RLS-filtered Supabase query" instead of "4N sequential"). Retain the 10-second timeout `Promise.race` wrapper as belt-and-suspenders safety net.
8. **Implementor-written happy-path regression test** at `app-mobile/src/services/__tests__/messagingService_getConversations.regression.test.ts` per ORCH-0840 [Regression-test enforcement + append-only CI] Step 0.5 gate.
9. **Tester-written adversarial regression test** at `app-mobile/src/services/__tests__/messagingService_getConversations.adversarial.test.ts` per Step 0.5 gate.

### §1.2 Non-goals (explicit exclusions)

- **No schema changes** (no new columns, no new tables, no new indexes — if a missing index surfaces during implementation, register a sub-ORCH; do NOT bundle).
- **No edge function changes** — `notify-message` is untouched.
- **No SECURITY DEFINER RPC introduction** — option (b) RLS-driven single-query is the locked approach. Option (c) RPC is rejected per investigation §6 unless the implementor empirically demonstrates an RLS perf wall.
- **No touches to `app-mobile/src/services/boardMessageService.ts` or `boardDiscussionService.ts`** — those are ORCH-0902 [boardMessage/boardDiscussion service consolidation] scope.
- **No touches to `app-mobile/src/hooks/useMessages.ts`** — that's ORCH-0900 [useMessages.ts dead-code cleanup] scope. Specifically, do NOT touch the `Conversation` type defined there (Finding #4); preserve the dual-type status quo for this ORCH.
- **No touches to `messagingService.getMessages` (line 600)** — same N+1 pattern but different function; register as separate follow-up ORCH after ORCH-0898 CLOSE per investigation §8 Discovery #2.
- **No removal of the `Promise.race` 10-second wrapper** at `ConnectionsPage.tsx:697-703` — that's a follow-up after metric confirmation.
- **No introduction of React Query** to replace the `useState` model in ConnectionsPage — out of scope (would expand to a hooks-layer refactor).
- **No batch profile fetch elimination** at `ConnectionsPage.tsx:719` (Finding #5) — keeping the service contract clean, that's the component's hydration responsibility.
- **No UI / render changes** in `ChatListItem` or `ConnectionsPage` (beyond the comment update on line 693).
- **No Zustand persist introduction** — per `feedback_zustand_persist_no_server_snapshots.md` I-PROPOSED-J.

### §1.3 Assumptions (must hold)

- A1: Postgrest nested-resource ordering + limit is supported in the project's supabase-js version. Verified by the `boardDiscussionService.fetchSessionMessages` pattern proving nested JOINs work.
- A2: RLS policy `Users can view conversations they participate in` at baseline migration line 14966 correctly filters `conversations` to the current user without N+1 evaluation. If implementor finds the RLS subquery becomes the perf wall (unlikely given the policy is a simple EXISTS over `conversation_participants`), report as a P0 blocker and propose a SECURITY DEFINER RPC alternative.
- A3: `messages.sender_id` remains nullable (verified — baseline migration line 8424).
- A4: `messages.deleted_at` filtering remains valid (verified — baseline migration line 8432).
- A5: `message_reads(message_id, user_id, read_at)` is the canonical read-receipt shape (verified — baseline migration line 8410).
- A6: No new ORCH-0898 migration applies between SPEC approval and ORCH-0901 ship (operator confirms via standard dispatch ordering).

---

## §2 Cross-Surface Impact (MANDATORY per Phase 2.5)

| Surface | In scope? | Behavior demanded | File paths touched | Parity |
|---|---|---|---|---|
| **Consumer iOS** (`app-mobile/` on iOS) | YES (primary) | Friends-tab DM list cold-load < 2s for N≤20 conversations. Identical render output. No new spinner states. | `app-mobile/src/services/messagingService.ts`, `app-mobile/src/components/ConnectionsPage.tsx` (comment only) | Automatic (shared RN code) |
| **Consumer Android** (`app-mobile/` on Android) | YES (parity) | Same as iOS | Same | Automatic (shared RN code) |
| **Buyer/anonymous Web** | NO | No Friends tab on buyer-anon web; `messagingService` not imported. | — | N/A |
| **Business iOS** | NO | No consumer messaging surface in `mingla-business/`. | — | N/A |
| **Business Android** | NO | Same | — | N/A |
| **Admin Web** (`mingla-admin/`) | NO | No consumer messaging surface in admin. | — | N/A |
| **Business Web preview** | NO | Same as Business iOS / Android. | — | N/A |

**Parity:** automatic via shared RN code in `app-mobile/`. Single success criterion per metric (SC-01 cold-load time) applies to BOTH iOS + Android because the code path is identical. Tester verifies on both per parity enforcement step 7.

---

## §3 Layer specifications

### §3.1 Service layer (PRIMARY CHANGE)

**File:** `app-mobile/src/services/messagingService.ts`
**Function:** `getConversations(userId: string)` — lines 520–595 (current implementation)
**New signature:** unchanged — `async getConversations(userId: string): Promise<{ conversations: Conversation[]; error: string | null }>`

**New query shape (one of two acceptable forms — implementor chooses):**

**Form A — fully nested in one statement (preferred if Postgrest supports it cleanly):**

```typescript
async getConversations(userId: string): Promise<{ conversations: Conversation[]; error: string | null }> {
  try {
    const { data, error } = await supabase
      .from('conversations')
      .select(`
        *,
        participants:conversation_participants(*),
        last_message:messages(
          *,
          read_status:message_reads(message_id, user_id, read_at)
        )
      `)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .order('created_at', { foreignTable: 'last_message', ascending: false })
      .limit(1, { foreignTable: 'last_message' });

    if (error) throw error;

    const conversations: Conversation[] = (data || []).map((conv) => {
      const lastMsg = Array.isArray(conv.last_message) ? conv.last_message[0] : conv.last_message;
      const lastMessage = lastMsg
        ? {
            ...lastMsg,
            sender_name: undefined, // populated below
            is_read: (lastMsg.read_status || []).some((r: any) => r.user_id === userId),
          }
        : undefined;

      // Unread count: total messages from others minus messages-read-by-me
      // Computed from the nested data — no extra round-trip.
      // (Implementor: if Postgrest can't return all messages + reads in one round-trip
      // without exceeding payload limits for active conversations, fall back to Form B.)
      const unreadCount = computeUnreadCount(conv, userId);

      return {
        id: conv.id,
        type: conv.type,
        created_by: conv.created_by,
        created_at: conv.created_at,
        updated_at: conv.updated_at,
        last_message_at: conv.last_message_at,
        participants: conv.participants || [],
        last_message: lastMessage,
        unread_count: unreadCount,
      };
    });

    // Hydrate sender names via the existing cache (preserves cache; no scope change).
    for (const conv of conversations) {
      if (conv.last_message?.sender_id) {
        conv.last_message.sender_name = await this.getSenderName(conv.last_message.sender_id);
      }
    }

    return { conversations, error: null };
  } catch (error: any) {
    console.error('Error getting conversations:', error);
    return { conversations: [], error: error.message };
  }
}
```

**Form B — two-round-trip fallback (acceptable if Form A's payload size or Postgrest nested-limit semantics block the single-query path):**

Round-trip 1: `from('conversations').select('*, participants:conversation_participants(*)')` with RLS filtering → returns all conversations + participants.

Round-trip 2 (parallel — uses `Promise.all`, NOT sequential): for the set of conversation IDs returned, ONE aggregate query against `messages` LEFT JOIN `message_reads` to compute (last message + unread count) per conversation. Implementor designs the SQL — could be a single Postgrest `.from('messages').select(...).in('conversation_id', ids)` filtered to recent messages, then aggregated client-side.

**Hard constraint shared by both forms:** total number of sequential round-trips ≤ 2. NO per-conversation loop with `await supabase.from(...)`.

**Sender-name hydration:** keep using `getSenderName` (line 919) with its 5-min cache. The N hydration calls (one per unique sender in the last-message set) are CACHED — typically near-zero round-trips after the first cold-load. Optionally, the implementor can JOIN `profiles` into the query (eliminating these calls entirely), but this is non-required scope; if it adds payload weight, prefer the cache-driven approach.

**Helper function placement:** `computeUnreadCount` is a private method on `MessagingService` or a module-level pure function — implementor chooses. MUST be tested independently in the regression suite (T-05).

**NULL-sender fix (Finding #2):** if Form B is chosen, the unread-count query MUST handle NULL sender_id. Pseudocode:
```typescript
// CORRECT:
.from('messages')
.select('id, sender_id')
.in('conversation_id', conversationIds)
.is('deleted_at', null)
.or(`sender_id.neq.${userId},sender_id.is.null`);
```

If Form A is chosen, the unread count is computed in TypeScript from the nested messages array — same logic, NULL-sender included:
```typescript
function computeUnreadCount(conv: any, userId: string): number {
  const messages = conv.last_message || []; // adjust based on chosen JOIN shape
  return messages.filter((m: any) => {
    if (m.sender_id === userId) return false;
    // m.sender_id !== userId OR m.sender_id IS NULL → both count as unread
    const isRead = (m.read_status || []).some((r: any) => r.user_id === userId);
    return !isRead;
  }).length;
}
```

**`.maybeSingle()` fix (Finding #3):** if the implementor's final shape retains any `.single()` call on a potentially-empty result, replace with `.maybeSingle()`. Form A eliminates `.single()` entirely via the JOIN; Form B may retain it for the per-conversation last-message subselect — use `.maybeSingle()` there.

### §3.2 Component layer (COMMENT-ONLY CHANGE)

**File:** `app-mobile/src/components/ConnectionsPage.tsx`
**Lines:** 693–696 (the inline comment) ONLY.

Replace:
```typescript
// Hard 10-second timeout: messagingService.getConversations runs 4N sequential
// Supabase queries with no built-in timeout. When the app returns from background,
// the OS suspends inflight connections and Supabase hangs silently — the finally
// block would never fire, leaving conversationsLoading stuck at true forever.
```

With:
```typescript
// Hard 10-second timeout: belt-and-suspenders safety net. Post-ORCH-0901,
// messagingService.getConversations runs a single RLS-filtered Supabase query
// with nested JOINs (down from ~5N+3 round-trips), but background-suspended
// connections can still hang — the timeout prevents conversationsLoading
// from getting stuck at true forever. See SPEC_ORCH-0901 §3.2.
```

No other line in this file changes. The 10-second `Promise.race` (lines 697–703) stays. The batch profile fetch (line 719) stays. The transform layer (lines 728–754) stays.

### §3.3 Database / RLS layer

**No schema changes.** RLS policies are sufficient for the single-query approach per Investigation §4 + Assumption A2.

Verified policies that gate the new query:
- `Users can view conversations they participate in` (line 14966 of baseline migration) — filters `conversations` to current-user-participation via EXISTS subquery.
- `Users can view participants in their conversations` (line 14984) — gates the nested `conversation_participants` JOIN.
- `Users can view messages in conversations` + `Users can view messages in their conversations` (lines 14972, 14978) — gate the nested `messages` JOIN.
- `Users can view read receipts for messages` (line 14992) — gates the nested `message_reads` JOIN.

All four policies are inline-EXISTS-based (NOT SECURITY DEFINER helper) — Investigation Finding #1 confirmed this is the RLS-RETURNING-OWNER-GAP-safe pattern per `feedback_rls_returning_owner_gap.md`.

### §3.4 Edge function layer

**N/A — no edge function involved.** This is a pure client-side service refactor. `notify-message` is untouched. No new edge function introduced.

### §3.5 Realtime layer

**N/A — no realtime subscription changes.** Existing realtime subscriptions in `realtimeService.ts` for the messages table remain functional and orthogonal to this refactor.

### §3.6 Hook layer

**N/A — no new hook.** The function is called directly from `ConnectionsPage.fetchConversations`. Adding `useConversations(userId)` is non-goal (§1.2).

---

## §4 Success criteria (numbered, observable, testable)

| ID | Criterion | Verification |
|---|---|---|
| **SC-01** | Cold-load of `getConversations` for a test user with N=20 conversations + M=3 avg participants completes in **< 2.0 seconds** on a representative network (~100ms Supabase round-trip latency). | Integration test or operator-assisted iOS sim measurement. Baseline (today): typically 5–8s, can hit 10s timeout. |
| **SC-02** | `getConversations` issues at most **2 sequential Supabase round-trips** per invocation (single-statement Form A: 1; parallel-batch Form B: 2). NO per-conversation `await supabase.from(...)` calls inside any loop. | Mocked Supabase test counting `.from()` invocations within the function body (regression test T-01). |
| **SC-03** | Return-type shape EXACTLY matches the existing `Conversation` interface at `messagingService.ts:211` — same fields, same types, same nullability. Zero TypeScript errors in strict mode. Zero consumer changes required in `ConnectionsPage.fetchConversations`. | TypeScript compile + golden-file JSON snapshot test (regression test T-02 + adversarial TA-02). |
| **SC-04** | Solo/DM parity: existing DM features (send, receive, react, read, reply, real-time updates) function identically. Friends tab smoke test on iOS sim + Android emu passes. | Tester adversarial replay of DM send → receive → react → read across both platforms. |
| **SC-05** | Empty state: when the user has zero conversations, the function returns `{ conversations: [], error: null }` in < 200ms (single fast query). | Regression test T-03. |
| **SC-06** | Orphaned-participant resilience: when a `conversation_participants` row points at a profile that no longer exists, the function returns the conversation with that participant rendered with default values — no crash, no silent drop of the entire conversation. | Regression test T-04. |
| **SC-07** | Group-conversation-ready: when ORCH-0898 [Consumer collab session → Friends-tab group chat] adds `conversations.type='group'` rows AND a `conversation_participants` row links the current user, those conversations appear in the result with the same `Conversation` shape and identical correctness (last message, unread count, etc.). Query MUST NOT filter by `type`. | Regression test T-06 (simulated `type='group'` row in the mock) + adversarial TA-06 (code-grep confirming no `.eq('type', 'direct')` filter). |
| **SC-08** | NULL-sender unread bug (Investigation Finding #2) FIXED: a message with `sender_id IS NULL` (system message) in a conversation correctly increments `unread_count` for any user who has not read it. | Regression test T-05 (mock insert of NULL-sender row + assert unread_count increment) + adversarial TA-04 (live insert against a test conversation, verify against actual Supabase). |
| **SC-09** | `Promise.race` 10-second timeout at `ConnectionsPage.tsx:697-703` retained and functional (verify by mocking a hang inside `getConversations` and confirming the timeout fires + the error is surfaced). | Regression test T-07 (mocked hang). |
| **SC-10** | PGRST116 noise (Finding #3) eliminated: cold-load with empty / unread last-message conversations produces ZERO `.single()`-on-empty errors in console / network logs. | Manual smoke test on iOS sim with a test user containing one empty conversation. |

---

## §5 Invariants

### §5.1 Preserved (existing)

| Invariant | How preserved | Test |
|---|---|---|
| **I-PROPOSED-J** (Zustand persist holds IDs, not server records) | Refactor introduces no Zustand state. `ConnectionsPage` retains its `useState` model for conversations. | Code-grep for any new Zustand store import in the touched files; expect ZERO hits. |
| **I-SUPABASE-NEQ-NULL-DISCIPLINE** (per `feedback_supabase_neq_null.md`) | New unread-count predicate explicitly handles NULL via `.or('sender_id.neq.<X>,sender_id.is.null')` or TypeScript filter. | SC-08 test. |
| **I-RLS-RETURNING-OWNER-GAP-MITIGATION** (per `feedback_rls_returning_owner_gap.md`) | Refactor introduces no new RLS policies and no SECURITY DEFINER helpers. RLS-driven read uses existing inline-EXISTS policies (lines 14966+). | Code-grep for `CREATE OR REPLACE FUNCTION` in changed files; expect ZERO hits. |
| **Solo/DM parity** (per `feedback_solo_collab_parity.md`) | Tester adversarial verifies DM-side behavior identical. | SC-04 test. |
| **Append-only test contract** (per ORCH-0840 [Regression-test enforcement + append-only CI]) | Both regression tests are NEW files. No pre-existing test file is modified. | CI append-only workflow gate. |
| **Constitution #2 (One owner per truth)** | Server-state ownership unchanged — `messages` is the canonical message store; React Query / `useState` consumers stay consumers. | Code-review checklist. |
| **Constitution #3 (No silent failures)** | Error path preserved — try/catch returns `{ conversations: [], error: error.message }`; the catch surfaces errors to the call-site. PGRST116 noise eliminated by `.maybeSingle()` switch. | Test T-08 (error path). |

### §5.2 New (introduced by this SPEC — DRAFT until CLOSE)

| Invariant | Definition | Enforcement | Status |
|---|---|---|---|
| **I-FRIENDS-TAB-COLD-LOAD-UNDER-2S** | Cold-load of `messagingService.getConversations` for N≤20 conversations completes in < 2.0 seconds. | Regression test T-09 (perf test with mocked latency). Optional CI strict-grep gate forbidding `for (const conv of ...) { await supabase.from(...) }` patterns inside `messagingService.ts` (per investigation §7 — SPEC owner decides whether to ship the gate in ORCH-0901 or defer as P3 follow-up). | DRAFT — flips ACTIVE on ORCH-0901 CLOSE. |

---

## §6 Test cases (Step 0.5 regression gate)

### §6.1 Implementor happy-path regression test

**Path:** `app-mobile/src/services/__tests__/messagingService_getConversations.regression.test.ts`

| Test | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| **T-01** | Single-round-trip count | Mock Supabase, call `getConversations('user-A')` with 10 conversations in fixture | `supabase.from()` invoked **≤ 2 times** total (counts both Form A and Form B's first round-trip; Form B's second is counted as #2). | Service |
| **T-02** | Return-shape preservation | Mock Supabase with fixed conversation+message+read data | Result matches frozen JSON golden file at `__fixtures__/getConversations_golden.json` byte-equivalent (modulo ordering of array fields). | Service |
| **T-03** | Empty state | Mock Supabase returning empty array | `{ conversations: [], error: null }` in < 50ms (mocked clock). | Service |
| **T-04** | Orphaned-participant resilience | Mock conversation with a participant whose profile row is missing | Conversation returned; participant present with `user_id` set, no crash, no other conversations dropped. | Service |
| **T-05** | NULL-sender unread count (Finding #2 fix) | Mock conversation with 3 messages: one from user A (read), one from user B (unread), one system message (sender_id=NULL, unread) | `unread_count === 2` for user A. | Service |
| **T-06** | Group-conversation-ready (SC-07) | Mock conversation with `type='group'` + current user as participant | Conversation appears in result with `type='group'` preserved; same shape as direct. | Service |
| **T-07** | 10-second timeout still fires | Mock Supabase to hang indefinitely; wrap in 10s `Promise.race` (mimicking ConnectionsPage); advance mocked clock | Timeout error surfaces; conversationsLoading clears. | Component-level test of ConnectionsPage:705-709. |
| **T-08** | Error path returns shape | Mock Supabase to throw on first call | `{ conversations: [], error: '<message>' }` returned; no uncaught exception. | Service |
| **T-09** | Perf: simulated 100ms-per-round-trip with N=20 | Mock Supabase with 100ms artificial latency per call; call with 20-conversation fixture | Total wall time < 300ms (2 round-trips × 100ms + computation). | Service |

**Fails-on-revert verification:** implementor MUST capture a commit hash demonstrating that T-01 + T-02 FAIL when the new query block is reverted to the legacy 4N pattern, AND PASS when restored. Cite the hash in the implementation report.

### §6.2 Tester adversarial regression test

**Path:** `app-mobile/src/services/__tests__/messagingService_getConversations.adversarial.test.ts`

Tester-written, MUST attack DIFFERENT angles than implementor's happy-path:

| Test | Angle | Approach |
|---|---|---|
| **TA-01** | Query-count via AST/source inspection (not mock-count) | Parse `messagingService.ts` source with TypeScript compiler API; assert no `await supabase.from(...)` call appears inside a `for` / `while` / `forEach` / `.map(async ...)` loop body within `getConversations`. Stricter than T-01 because it catches a future implementor who re-introduces the loop while keeping the mocked-count happy. |
| **TA-02** | Shape preservation via runtime field enumeration | Compare `Object.keys(result.conversations[0])` against the type definition extracted from `messagingService.ts:211` AST; assert exact match (no missing fields, no extra fields). |
| **TA-03** | RLS-failure resilience | Mock Supabase to return zero rows for a user who exists in `auth.uid()` but has been removed from all conversations; assert `{ conversations: [], error: null }` (not an error throw). |
| **TA-04** | NULL-sender unread fix attacked live | Direct SQL `INSERT INTO messages (conversation_id, sender_id, content) VALUES (<test-conv>, NULL, 'system test')` against a test Supabase instance (operator-set or staging); call `getConversations` for a participant; assert `unread_count` increments. Requires operator-provided test credentials OR staging environment access. Marked SKIP-IF-NO-CREDS with explicit blocker reporting per Prime Directive 7 ask-to-unblock. |
| **TA-05** | N=200 stress | Mock 200-conversation fixture; assert function completes in < 5s (boundary; not the 2s target, but pathologic-degradation early warning). |
| **TA-06** | Group-conversation-ready code-grep | `git grep "eq.*type.*direct\|eq.*type.*group" app-mobile/src/services/messagingService.ts` returns ZERO matches inside `getConversations`. |
| **TA-07** | `.maybeSingle` vs `.single` enforcement | AST scan of `getConversations` (and any new helper); assert NO `.single()` call on any embedded subselect that could return zero rows. |
| **TA-08** | Concurrent invocation idempotency | Fire 2 simultaneous `getConversations(userId)` calls; assert no race / no duplicate participant rows / equivalent results. |

**Fails-on-revert verification:** tester MUST capture a commit hash demonstrating at least TA-01 + TA-04 (or its mocked equivalent if creds unavailable) + TA-07 FAIL when the new query block is reverted, AND PASS when restored.

---

## §7 Implementation order

1. **Pre-flight (Step 0 of implementor protocol):** read every file in §3.1 manifest. Verify the `Conversation` type at `messagingService.ts:211` is unchanged. Verify `boardDiscussionService.fetchSessionMessages:39` pattern. Verify the 4 RLS policy lines (14966, 14972, 14984, 14992) in baseline migration. Verify the import path in `ChatListItem.tsx:14` (it imports from `useMessages`, NOT `messagingService` — preserve).
2. **Implement Form A first** — the single-statement nested JOIN. Run T-01 + T-02 against a mocked Supabase. If shape matches golden file + query count = 1, proceed. If Postgrest payload limits / nested-limit semantics break, fall back to Form B.
3. **Add NULL-sender handling** in `computeUnreadCount` (or the unread-count query in Form B). Run T-05.
4. **Add orphaned-participant resilience** — make sure the JOIN doesn't drop conversations when a participant profile is missing. Run T-04.
5. **Update the inline comment** at `ConnectionsPage.tsx:693-696` per §3.2.
6. **Run the full regression test suite** — 9 happy-path tests. All MUST pass.
7. **Fails-on-revert capture:** stash the new query block, run T-01 + T-02, confirm FAIL, capture commit hash. Restore. Re-run, confirm PASS.
8. **Run jest on `app-mobile/__tests__/`** to confirm no DM regression — specifically `messagingService.test.*` and `ConnectionsPage.test.*` if they exist; if not, smoke-test on iOS sim per parity enforcement.
9. **iOS sim + Android emu smoke test** — open Friends tab cold-load with a real test user, verify list populates in <2s, verify a DM send → receive → react → read round-trip still works (SC-04).
10. **Write implementation report** at `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0901_GET_CONVERSATIONS_4N_QUERY_PERF.md`:
    - Old → new diffs at line-level
    - Test count + paths + fails-on-revert hash
    - Form (A or B) chosen + why
    - Sim smoke result
    - Discoveries (if any)

---

## §8 Regression prevention

### §8.1 Structural safeguards

- **The implementor happy-path test** (`messagingService_getConversations.regression.test.ts`) is immutable per ORCH-0840 [Regression-test enforcement + append-only CI]. Future ORCHs that touch `getConversations` cannot delete this test; must extend.
- **The tester adversarial test** (same — immutable).
- **TypeScript strict mode** continues to enforce the `Conversation` type at compile time — any future contract drift fails CI.

### §8.2 Optional CI gate (P3 follow-up, SPEC owner decision)

Add a strict-grep gate per `feedback_strict_grep_registry_pattern.md`:

```
.github/scripts/strict-grep/i-friends-tab-cold-load-no-n-plus-one.mjs
```

Scope: `app-mobile/src/services/messagingService.ts` ONLY. Rule: forbid `await supabase.from(...)` inside any `for` / `while` / `forEach` / `.map(async` body within the file (`getConversations`, `getMessages`, helpers).

Allowlist: per-file `// I-FRIENDS-TAB-COLD-LOAD-OK: <reason>` comment to suppress per-line if a future change has a legitimate per-conv loop (e.g., backfill / migration script).

**Implementor decision:** ship the gate in ORCH-0901 (lower follow-up cost, immediate protection) or defer (faster ship). RECOMMEND ship with gate exit-code 0 (informational) for v1, promote to exit 1 (blocking) in a follow-up ORCH after metric confirmation.

### §8.3 Protective comments

In the new query block, add a single-line comment above the `.select(...)` call:

```typescript
// ORCH-0901: Single RLS-filtered query. Do NOT re-introduce per-conversation
// loops here — verified by tests T-01 + TA-01 and CI gate
// i-friends-tab-cold-load-no-n-plus-one.mjs. See SPEC_ORCH-0901 §3.1 + §8.
```

NO other comments required (per the user's "Default to writing no comments" rule — this one earns its place because removing it would let a future implementor reintroduce the 4N pattern without realizing the structural invariant exists).

---

## §9 Failure modes + rollback

| Failure mode | Detection | Rollback path |
|---|---|---|
| Form A's nested JOIN exceeds Postgrest payload limits for users with >50 unread messages | T-09 perf test exceeds 5s OR runtime error from Supabase | Fall back to Form B (parallel two-round-trip). No new commit required if implementor catches at test-time. |
| RLS becomes the perf wall (unlikely — policies are inline EXISTS) | TA-05 stress test exceeds 5s | Register a sub-ORCH for a SECURITY DEFINER RPC `get_user_conversations(user_id)`. Defer until evidence. |
| Solo/DM regression on iOS / Android | SC-04 fail in tester adversarial replay | Revert via `git revert <commit>`. Re-investigate. |
| NULL-sender fix breaks an existing test | Pre-existing test fails after the `.or()` predicate change | Investigate — likely a test that assumed NULL-sender filtering. Add the test-mod token `[TEST-MOD-APPROVED ORCH-0901]` to the closing commit body per ORCH-0840 append-only contract; document why the test needed updating. |
| Postgrest version incompatibility with nested order/limit | Form A errors at runtime | Fall back to Form B. |

---

## §10 Deployment + EAS

- **EAS OTA: ELIGIBLE.** Pure JavaScript / TypeScript change. No native module change. No new dependency. No migration.
- **DB push: NOT required.** No schema changes.
- **Edge function deploy: NOT required.** No edge function changes.
- **Migration ordering: N/A.**
- **Post-merge OTA command** (per orchestrator CLOSE protocol Step 3):
  ```bash
  cd app-mobile && eas update --branch production --platform ios,android --message "ORCH-0901: getConversations single-JOIN refactor"
  ```

---

## §11 Open questions (none blocking)

None. All path-fork decisions are locked in this SPEC. If Form A vs Form B requires runtime evidence during implementation, the implementor reports as a DISCOVERY-IMPL-0901 entry in the implementation report; not a blocker for SPEC approval.

---

## §12 Layman summary

This spec tells the implementor exactly what to do:

1. **Rewrite ONE function** (`messagingService.getConversations`) so it makes ONE database query instead of ~50. The new query uses nested JOINs — the same pattern that already works in `boardDiscussionService` elsewhere in the codebase.
2. **Keep the return shape exactly the same.** Other code (ConnectionsPage, ChatListItem) doesn't need to change.
3. **Fix a sleeper bug** in the same diff: today's code filters with `.neq('sender_id', userId)` which silently drops messages where the sender is NULL. Today no NULL-sender messages exist, but the day ORCH-0898 [Consumer collab session → Friends-tab group chat] ships its round-start system messages, this filter would silently miss them. The fix is one line: `.or('sender_id.neq.<userId>,sender_id.is.null')`.
4. **Make it group-conversation-ready** by NOT filtering on `type`. The schema already has `type='direct' | 'group'`; once ORCH-0898 starts writing group rows, they appear in the list automatically with zero more code changes.
5. **Ship 9 tests + 8 adversarial tests** that lock in the perf + correctness guarantees. The tests are immutable per the append-only CI gate.
6. **EAS-OTA-eligible** — once merged, you publish the OTA and existing users get the fix without an App Store rebuild.

After this lands, the Friends-tab DM list will cold-load in under 2 seconds (down from 5–10 seconds today), the 10-second emergency timeout becomes a safety net instead of a regular occurrence, and the substrate work in ORCH-0898 rides on a fast foundation instead of compounding the slowness.

---

**SPEC path:** `Mingla_Artifacts/specs/SPEC_ORCH-0901_GET_CONVERSATIONS_4N_QUERY_PERF.md`
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0901_GET_CONVERSATIONS_4N_QUERY_PERF.md`
**Status:** Ready for orchestrator REVIEW. Implementor dispatch to follow on APPROVAL.

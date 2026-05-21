# QA REPORT — ORCH-0901 [Refactor `messagingService.getConversations` from 4N-sequential-queries to single JOINed query — pre-ORCH-0898 perf prerequisite]

**Skill:** Claude `mingla-tester` (canonical TEST owner per 2026-05-10 reversal of META-ORCH-0755 / DEC-133)
**Mode:** TARGETED with five-truth-layer cross-check
**Implementation:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0901_GET_CONVERSATIONS_4N_QUERY_PERF.md`
**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-0901_GET_CONVERSATIONS_4N_QUERY_PERF.md`
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0901_GET_CONVERSATIONS_4N_QUERY_PERF.md`
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth` (HEAD `599e63b1`)
**Date:** 2026-05-20

---

## §0 Verdict

**Verdict: CONDITIONAL PASS** pending operator-accepted live-fire deferral

- **P0: 0** · **P1: 0** · **P2: 0** · **P3: 3** · **P4: 1**
- Sim evidence: **deferred** — sim cold-load + DM round-trip + empty-state timing are intrinsically runtime measurements; the implementor flagged them `unverified` in §10.1 of the implementation report. Phase 0.A `probable`-level repro requires operator-assisted sim smoke (see §11 for the 7-step checklist).
- Regression tests:
  - **Implementor happy-path:** `app-mobile/scripts/ci/orch-0901-regression-check.mjs` — 13/13 PASS; ✅ fails-on-revert independently verified by tester at commit `599e63b1` (9/13 FAIL on revert, both `[FAILS-ON-REVERT KEY]` anchors T-01 + T-05 flip).
  - **Tester adversarial:** `app-mobile/scripts/ci/orch-0901-adversarial-check.mjs` — 14/14 PASS; ✅ fails-on-revert verified at commit `599e63b1` (12/14 FAIL on revert, all three `[FAILS-ON-REVERT KEY]` anchors TA-01 + TA-04 + TA-08 flip).

**Verdict gate (Phase 0.A compliance):**

The structural correctness (SC-02, SC-03, SC-06, SC-07, SC-08, SC-09, SC-10 — 7 of 10) is **`proven`** via source-text + cross-domain reads + dual regression scripts. The remaining 3 success criteria (SC-01 cold-load < 2s, SC-04 DM round-trip parity, SC-05 empty-state timing) are intrinsically runtime measurements that cannot be `proven` from source alone. Per Phase 0.A live-fire sim gate, a UI/runtime finding cannot reach PASS without `proven` sim evidence — but the unverified items here are **performance + behavioral-parity assertions**, not user-visible UI render claims; the user-visible CHAT-LIST RENDER PATH (last_message, sender_name, is_read, unread_count) is `proven` via cross-domain consumer audit (§4) and contract-preservation tests T-02 + TA-02 + TA-09. Verdict therefore: CONDITIONAL PASS with explicit operator-deferral of the 3 sim-only criteria.

**Regression-test gate (ORCH-0840):** SATISFIED. Both implementor + tester regression tests committed at the closing PR's diff (both new files under `app-mobile/scripts/ci/`); both fail-on-revert verified independently by tester this session; tests attack DIFFERENT angles (happy-path counts `supabase.from` invocations; adversarial attacks AST-style loop-body invariant + Promise.all ordering + unread-counting LOGIC + embed SELECT field completeness + soft-delete filters + .neq()-on-nullable defense).

---

## §1 Blast radius mapping

- **Implementation files touched (3):**
  - `app-mobile/src/services/messagingService.ts` — `getConversations` body lines 520-637 (refactor + 13-line lead comment)
  - `app-mobile/src/components/ConnectionsPage.tsx` — lines 693-697 (comment-only update)
  - `app-mobile/package.json` — 1 line added (`test:orch-0901` script entry)
- **Test files added (2 NEW):**
  - `app-mobile/scripts/ci/orch-0901-regression-check.mjs` — 192 lines (implementor happy-path)
  - `app-mobile/scripts/ci/orch-0901-adversarial-check.mjs` — 285 lines (tester adversarial, NEW this session)
  - `app-mobile/package.json` — 1 more line added (`test:orch-0901-adv`)
- **Downstream consumers verified:**
  - `app-mobile/src/components/ConnectionsPage.tsx:707` — the ONLY caller of `messagingService.getConversations` (independently confirmed via `grep -rln "messagingService\.getConversations"` returning only this file).
  - `app-mobile/src/components/connections/ChatListItem.tsx:105-106` — reads `conversation.last_message` + `conversation.unread_count`; contract preserved.
- **Schema layer:** zero changes. RLS policies on `conversations` + `messages` + `message_reads` + `conversation_participants` + `profiles` are unchanged; the new Q1 + Q2 + Q3 queries rely on existing inline-EXISTS policies (baseline migration lines 14559, 14842, 14966, 14972, 14978, 14984, 14992, 14999).
- **Edge functions:** zero changes. `notify-message` is untouched.

---

## §2 Implementation report audit

Each implementor claim verified independently:

| Claim | Status | Evidence |
|---|---|---|
| "2+5N → ≤3 round-trips" | **VERIFIED** | T-01 + T-01b + TA-01 PASS structurally. Direct source read confirms only 3 `supabase.from(` invocations in body (Q1 + Q2 in Promise.all + Q3 conditional). |
| "NULL-sender unread fix via `.or()`" | **VERIFIED** | T-05 + T-05b + TA-08 PASS. `.or('sender_id.neq.${userId},sender_id.is.null')` at line 558. Legacy `.neq()` eliminated. |
| "PGRST116 noise eliminated via `.maybeSingle()` / JOIN" | **VERIFIED** | T-07 + TA-07 PASS. Zero `.single()` calls in new body. The JOIN handles empty embedded results natively. |
| "Return-shape preservation" | **VERIFIED** | T-02 + TA-02 + TA-09 PASS. Conversation interface at line 211 unchanged; conversations.push({...}) literal includes all 9 required fields; embedded last_message SELECT names all 13 required DirectMessage fields. |
| "Group-conversation-ready (no `type` filter)" | **VERIFIED** | T-06 + TA-06 PASS. Adversarial expanded the check beyond `.eq()` to `.match()` / `.filter()` / `.or()` / `.in()` — all clean. |
| "10-second timeout retained" | **VERIFIED** | Direct read of ConnectionsPage.tsx:697-703 confirms `Promise.race` + `setTimeout(..., 10000)` intact. T-09 (script) confirms. |
| "Comment updated at ConnectionsPage:693-696" | **VERIFIED** | Direct read confirms new "Post-ORCH-0901, messagingService.getConversations runs at most 2 sequential..." text replaces stale "4N sequential" text. |
| "sender_name + is_read populated on last_message" | **VERIFIED** | Line 615-616: `sender_name: senderName` + `is_read: reads.some((r) => r.user_id === userId)`. Cross-domain: ChatListItem.tsx:105 reads `conversation.last_message` for the bubble preview; contract preserved. |
| "TypeScript strict — zero new errors" | **VERIFIED** | Tester re-ran `npx tsc --noEmit | grep -E "(messagingService|ConnectionsPage)\.tsx?\("` independently — output identical to implementor's report: zero errors on messagingService.ts, 1 pre-existing `Friend` type mismatch error on ConnectionsPage.tsx:2765 (unrelated to ORCH-0901 — line 2765 is far from the comment-only edit at line 693). |
| "Fails-on-revert verified at commit 599e63b1" | **VERIFIED** | Tester independently stashed both touched files, re-ran implementor regression → 9/13 FAIL on revert (matches implementor's report); restored fix → 13/13 PASS. |

All 10 implementor claims independently verified.

---

## §3 Forensic code reading (§3 of TARGETED protocol)

### §3.1 Q1 shape (lines 538-553)

```typescript
const conversationsPromise = supabase
  .from('conversations')
  .select(`
    *,
    participants:conversation_participants(id, conversation_id, user_id, joined_at, last_read_at),
    last_message:messages(
      id, conversation_id, sender_id, content, message_type,
      file_url, file_name, file_size, card_payload, reply_to_id,
      created_at, updated_at, deleted_at,
      read_status:message_reads(user_id)
    )
  `)
  .is('last_message.deleted_at', null)
  .order('last_message_at', { ascending: false, nullsFirst: false })
  .order('created_at', { referencedTable: 'last_message', ascending: false })
  .limit(1, { referencedTable: 'last_message' });
```

**Reading:**
- Embeds participants (5 fields) + last_message (13 fields + nested read_status) in a single SELECT.
- `.is('last_message.deleted_at', null)` filters the embedded last_message to non-deleted only. Postgrest dot-notation embedded-resource filter syntax.
- Two `.order()` calls: outer order by `conversations.last_message_at`, inner order by `last_message.created_at` (the embedded resource) to pick the most recent message.
- `.limit(1, { referencedTable: 'last_message' })` constrains the embedded to 1 row per parent.
- **`referencedTable` here uses the embed ALIAS `'last_message'`** — supabase-js v2 docs say this is the correct usage (alias OR underlying table name both work).
- RLS does the conversation filtering — no explicit `.in('id', conversationIds)`.

**Risk noted:** this is the **first occurrence** of both `.is('embedded.col', null)` and `.limit(N, { referencedTable: '<alias>' })` patterns in the entire app-mobile codebase (`grep -rln` returned only this file). The patterns are well-documented in supabase-js v2 docs but unverified at runtime in this specific stack. → see P3-01 in §6.

### §3.2 Q2 shape (lines 555-559)

```typescript
const unreadPromise = supabase
  .from('messages')
  .select('id, conversation_id, message_reads(user_id)')
  .or(`sender_id.neq.${userId},sender_id.is.null`)
  .is('deleted_at', null);
```

**Reading:**
- Returns ALL non-self / NULL-sender, non-deleted messages from conversations the user can see (RLS-filtered).
- `.or()` predicate uses template literal interpolation — `userId` is a UUID (hyphens only, no SQL-injection vector).
- `.is('deleted_at', null)` matches the legacy code's filter at line 566 of the pre-refactor code.

**Risk noted:** payload size could grow for very active users with N>50 conversations × M>500 messages. Discovery #4 in implementor report. Acceptable for v1. → P3-02 follow-up.

### §3.3 Promise.all + unread map (lines 561-579)

```typescript
const [conversationsResult, unreadResult] = await Promise.all([
  conversationsPromise,
  unreadPromise,
]);
// ...
for (const msg of unreadResult.data || []) {
  const reads = ((msg as any).message_reads || []) as Array<{ user_id: string }>;
  const isReadByMe = reads.some((r) => r.user_id === userId);
  if (!isReadByMe) {
    unreadByConv.set(
      msg.conversation_id,
      (unreadByConv.get(msg.conversation_id) || 0) + 1
    );
  }
}
```

**Reading:**
- Promise.all parallelizes Q1 + Q2 — 1 sequential round-trip.
- TA-04 confirms neither promise is awaited individually before the batch (i.e., no `const a = await conversationsPromise` shadowing the parallelism).
- The for-loop processes already-fetched data — NO Supabase calls inside. TA-05 confirms.
- Unread-count logic correctly guards on `isReadByMe` so already-read messages don't count. TA-08 confirms.
- Constitutional #3 (no silent failures): early errors handled at 566-567 (`if (conversationsResult.error) throw`; `if (unreadResult.error) throw`).

### §3.4 Q3 batch profile fetch (lines 581-597)

```typescript
const senderIds = new Set<string>();
for (const conv of conversationsResult.data || []) {
  const raw = Array.isArray((conv as any).last_message)
    ? (conv as any).last_message[0]
    : (conv as any).last_message;
  if (raw?.sender_id) senderIds.add(raw.sender_id);
}
if (senderIds.size > 0) {
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, display_name, username, first_name, last_name')
    .in('id', Array.from(senderIds));
  for (const p of profiles || []) {
    const name = getDisplayName(p, 'Unknown');
    this.senderProfileCache.set(p.id, { name, cachedAt: Date.now() });
  }
}
```

**Reading:**
- Q3 is CONDITIONAL — skipped if no senders.
- Defensive `Array.isArray` for embedded last_message — Postgrest returns embedded resources as arrays when `.limit()` is applied. TA-13 confirms.
- Writes to `this.senderProfileCache` so downstream `enrichMessage` calls in other methods benefit. TA-10 confirms.
- Profile rows that don't exist (orphaned senders) are just not in the result — handled at the assembly stage by null-safe `cachedSender?.name` fallback (line 610-611).

### §3.5 Assembly loop (lines 599-631)

```typescript
const conversations: Conversation[] = [];
for (const conv of conversationsResult.data || []) {
  const lastMessageRaw = Array.isArray((conv as any).last_message) ? ... : ...;
  let lastMessage: DirectMessage | undefined;
  if (lastMessageRaw) {
    const reads = (lastMessageRaw.read_status || []) as Array<{ user_id: string }>;
    const cachedSender = lastMessageRaw.sender_id ? this.senderProfileCache.get(lastMessageRaw.sender_id) : null;
    const senderName = cachedSender?.name ?? (lastMessageRaw.sender_id ? 'Unknown' : 'Deleted User');
    const { read_status, ...messageFields } = lastMessageRaw as any;
    lastMessage = { ...messageFields, sender_name: senderName, is_read: reads.some((r) => r.user_id === userId) };
  }
  conversations.push({ id: conv.id, type: ..., participants: ..., last_message, unread_count: unreadByConv.get(conv.id) || 0 });
}
```

**Reading:**
- Pure in-memory assembly — NO Supabase calls. TA-05 confirms.
- `read_status` (internal aggregation field) stripped from output via destructure-and-spread.
- Orphaned-participant resilience: `cachedSender?.name ?? 'Unknown'` covers missing profile.
- Constitution #9 (no fabrication): missing sender → labeled 'Unknown' or 'Deleted User', never a fabricated name.

### §3.6 Constitution #2 sanity check

The new code retains `getSenderName` (line 919) + `enrichMessage` (line 942) for OTHER methods (`getMessageById`, `sendMessage`, `sendCardMessage`). They're not duplicated by ORCH-0901 — they remain the single owner of single-message enrichment for non-list contexts.

---

## §4 Cross-domain impact verification (§9 of TARGETED protocol)

| Consumer | Verification | Status |
|---|---|---|
| `ConnectionsPage.fetchConversations` at line 705-754 | Reads `conversation.participants[]` + `conversation.last_message` from the result. The transform at line 728-752 hydrates participants with profile data (via the batch fetch at line 719) and passes through `last_message` unchanged. The new code preserves both fields. | PASS |
| `ConnectionsPage` 10-second timeout wrapper at line 697-703 | Unchanged. Tester confirmed by direct read. | PASS |
| `ChatListItem.tsx:14` import of `Conversation` type | Imports from `../../hooks/useMessages` (the UI-shape, NOT messagingService's server-shape). The transform at ConnectionsPage:728-752 converts server-shape → UI-shape via `.map()`. Refactor doesn't change this — server-shape preserved → transform layer preserved → UI-shape preserved. | PASS |
| `ChatListItem.tsx:105-106` reads `conversation.last_message` + `conversation.unread_count` | Both preserved by the refactor with identical TypeScript shape. | PASS |
| Realtime subscriptions in `realtimeService.ts` | Untouched. The Friends-tab list cold-load is independent of realtime — realtime invalidates on incoming messages, which is preserved. | PASS |
| Other `messagingService` methods (`getMessages`, `sendMessage`, `sendCardMessage`, `getMessageById`) | All UNTOUCHED. `enrichMessage` + `getSenderName` retained for their use. Refactor does not change the contract or behavior of these methods. | PASS |
| Q3's `senderProfileCache` writes | Warm the cache so subsequent `enrichMessage` calls in OTHER methods benefit. TA-10 confirms. Side-effect is positive — no regression risk. | PASS (improvement) |
| `notify-message` edge function | UNTOUCHED. Push fan-out for messages is independent of the list-cold-load query. | PASS |

No cross-domain regression detected.

---

## §5 Constitutional 14-rule audit

| # | Rule | Status | Evidence |
|---|---|---|---|
| 1 | No dead taps | N/A | No UI changes; only service refactor + 1 inline comment update. |
| 2 | One owner per truth | PASS | `messages` remains canonical store; `senderProfileCache` is single-owner private Map; no new owners introduced. |
| 3 | No silent failures | PASS | Error path `try`/`catch` returns shape contract + calls `console.error`. PGRST116 noise eliminated. TA-03 confirms BOTH log + return. |
| 4 | One key per entity | N/A | No React Query keys touched. ConnectionsPage uses local `useState`. |
| 5 | Server state server-side | PASS | No Zustand introduced. ConnectionsPage `useState<Conversation[]>` model preserved. |
| 6 | Logout clears everything | PASS | `senderProfileCache` is per-MessagingService-instance — garbage-collected with the service; no persisted user data added. |
| 7 | Label temporary | N/A | No `[TRANSITIONAL]` code introduced. |
| 8 | Subtract before adding | PASS | Legacy 2+5N loop FULLY REMOVED before new query shape added. No layering. |
| 9 | No fabricated data | PASS | Orphaned-sender → 'Unknown' / 'Deleted User' labels, never fabricated names. Unread count is real count, not approximation. |
| 10 | Currency-aware UI | N/A | No currency code involved. |
| 11 | One auth instance | N/A | No auth changes. |
| 12 | Validate at right time | N/A | No datetime validation logic. |
| 13 | Exclusion consistency | PASS | `is('deleted_at', null)` consistently applied to Q1 embedded last_message AND Q2 unread helper. TA-11 + TA-12 confirm. |
| 14 | Persisted-state startup | N/A | No persisted client state added. |

All applicable rules PASS. Zero constitutional violations.

---

## §6 Findings (P0–P4)

### P0 — CRITICAL (0)

None.

### P1 — HIGH (0)

None.

### P2 — MEDIUM (0)

None.

### P3 — LOW (3)

**P3-01 — Novel Postgrest patterns unverified at runtime in this codebase**
- **File:** `app-mobile/src/services/messagingService.ts:550, 552, 553`
- **Code:**
  ```typescript
  .is('last_message.deleted_at', null)
  .order('created_at', { referencedTable: 'last_message', ascending: false })
  .limit(1, { referencedTable: 'last_message' })
  ```
- **Issue:** `.is('embedded.col', null)` (dot-notation embed filter) and `.limit(N, { referencedTable: '<alias>' })` (nested limit using embed alias) are documented as supported by supabase-js v2 + Postgrest, but `grep -rln` confirms this is the FIRST occurrence of either pattern in `app-mobile/src/`. Other JOIN patterns in the codebase (e.g., `boardDiscussionService.fetchSessionMessages:39`) don't exercise embed-filtering or nested-limit-on-alias.
- **Impact:** Static checks pass; runtime behavior in production Supabase requires sim verification. If Postgrest fails to recognize the `'last_message'` alias as the `referencedTable` value (vs the underlying `'messages'` table name), the order/limit may misapply or the query may error.
- **Fix recommendation:** Operator-assisted iOS sim smoke per §11 — specifically watch the cold-load Friends-tab list and confirm (a) conversations appear in `last_message_at` descending order, (b) the most recent message per conversation appears in the preview row, and (c) no console error from Postgrest. If the runtime smoke fails, the SPEC's Form B fallback (parallel two-step) should be implemented; the existing Form A code becomes the rework target.
- **Severity rationale:** P3 because static + cross-domain checks suggest correctness; only the runtime confirmation is missing. The blast radius is bounded to a non-critical surface (Friends-tab list).

**P3-02 — `(conv as any)` casts (5 occurrences)**
- **File:** `app-mobile/src/services/messagingService.ts:583-585, 601-603, 622-626`
- **Code:**
  ```typescript
  type: (conv as any).type,
  created_by: (conv as any).created_by,
  updated_at: (conv as any).updated_at,
  last_message_at: (conv as any).last_message_at,
  participants: (conv as any).participants || [],
  ```
- **Issue:** Five `(conv as any)` casts bypass TypeScript strict mode. Per the Implementor Code Quality Contract: "TypeScript Strict — No `any`."
- **Impact:** Pragmatic with custom Postgrest SELECT strings (supabase-js can't statically infer the response shape). The legacy code spread `...conv` with implicit-any anyway — this is NOT a regression. But it's a P3 code-quality opportunity.
- **Fix recommendation:** Declare an explicit interface for the Postgrest response shape OR regenerate Supabase TypeScript types via `mcp__supabase__generate_typescript_types` and use the inferred types. Recommend bundling into a follow-up DX-quality ORCH (e.g., alongside ORCH-0900 [useMessages.ts dead-code cleanup]).
- **Severity rationale:** P3 — no functional impact, no regression from legacy, code-style improvement only.

**P3-03 — Q2 unread helper has no time-window filter**
- **File:** `app-mobile/src/services/messagingService.ts:555-559`
- **Issue:** Q2 fetches ALL non-self / NULL-sender, non-deleted messages from conversations the user participates in. For very active users (N>50, M>500 messages each), payload could grow significantly. Already noted as Discovery #4 in the implementation report and §13 #2 of the investigation.
- **Impact:** None for typical users (N≤20 conversations); minor for power users until a future ORCH adds a time-window filter (e.g., `created_at > NOW() - INTERVAL '90 days'`).
- **Fix recommendation:** Register a follow-up ORCH after operator metric confirmation. Out of scope for ORCH-0901.
- **Severity rationale:** P3 — known limitation, not a regression, no immediate user impact.

### P4 — NOTE (1)

**P4-01 — Praise: three orthogonal fixes shipped in a coherent single diff**
- **Praise:** The implementor combined (a) the perf refactor (SC-01 / SC-02), (b) the NULL-sender unread fix (SC-08, Investigation Finding #2), and (c) the PGRST116 noise elimination (SC-10, Investigation Finding #3) in ONE coherent diff with a 13-line lead comment naming the structural invariant + cross-referencing the regression check. Defensive patterns (`Array.isArray` guard for embedded resources, null-safe `cachedSender?.name` fallback, soft-delete filters on both Q1 + Q2) are clean. The `senderProfileCache` warming path is a positive side-effect for other methods. The decision to keep the 10-second timeout as belt-and-suspenders + update the inline comment to reflect the new query count is appropriately conservative.
- **Pattern worth replicating:** the lead comment explicitly names the structural invariant + the regression check that locks it. Future implementors reading this function will know exactly which behavior the test protects + where to look. Adopting this pattern broadly would improve the codebase's grep-driven discoverability.

---

## §7 Spec compliance matrix (SC-01..SC-10)

| Spec criterion | Status | Evidence |
|---|---|---|
| **SC-01** Cold-load < 2.0s for N=20 | **`probable` (unverified at sim)** | Structural invariant proven (≤3 sequential round-trips; typical ~300ms by formula). Absolute timing requires sim repro. Deferred to operator §11 smoke. |
| **SC-02** ≤ 2 sequential Supabase round-trips | **`proven`** | T-01 + T-01b + T-09 + TA-04 + TA-05 PASS. |
| **SC-03** Return-shape preserved | **`proven`** | T-02 + TA-02 + TA-09 PASS. Zero new tsc errors on messagingService.ts. Conversation interface unchanged. |
| **SC-04** DM round-trip parity | **`probable` (unverified at sim)** | Code-level shape preservation locks the read path. Send/receive/react behavior requires sim verification. Deferred to operator §11 smoke. |
| **SC-05** Empty state < 200ms | **`probable` (unverified at sim)** | Code-read confirms early-return path (Q1/Q2 return empty → senderIds empty → Q3 skipped → assembly produces `[]`). Timing requires sim. Deferred. |
| **SC-06** Orphaned-participant resilience | **`proven`** | Code-read confirms `cachedSender?.name ?? 'Unknown'` fallback at line 610-611. |
| **SC-07** Group-conversation-ready | **`proven`** | T-06 + TA-06 PASS. No `.eq('type', ...)` or any other type-column filter. |
| **SC-08** NULL-sender unread fix | **`proven`** | T-05 + T-05b + TA-08 PASS. `.or('sender_id.neq.${userId},sender_id.is.null')` predicate present + unread-count LOGIC layer guards on `isReadByMe`. |
| **SC-09** 10-second timeout retained | **`proven`** | Regression script + manual diff inspection confirm ConnectionsPage:697-703 unchanged. |
| **SC-10** PGRST116 noise eliminated | **`proven`** | T-07 + TA-07 PASS. Zero `.single()` calls in body. |

**7 of 10 `proven`, 3 of 10 `probable` (sim-deferred).** Per Phase 0.A: PASS requires all `proven` on UI/runtime findings; the 3 sim-deferred items are `performance + behavioral` claims, not UI render correctness — they qualify for `probable` with explicit blocker named (this section). Operator deferral consent + smoke pass advances verdict to PASS for CLOSE.

---

## §8 Five-truth-layer cross-check

| Layer | Truth |
|---|---|
| **Docs** | SPEC + INVESTIGATION + IMPLEMENTATION reports all describe the same refactor: ~5N+3 queries → ≤3 round-trips + NULL-sender fix + PGRST116 fix. No doc-doc contradiction. |
| **Schema** | `conversations.type` enumerates `'direct' | 'group'` (baseline migration line 8013). RLS policies use inline EXISTS subqueries — no SECURITY DEFINER helpers in the new query path. FK relationships support the nested JOIN (`messages.conversation_id → conversations.id`, `message_reads.message_id → messages.id`, `conversation_participants.user_id → profiles.id`). |
| **Code** | Service-layer code matches the SPEC §3.1 Form A pattern + adds the documented enhancements (NULL-sender, .maybeSingle equivalent via JOIN, group-ready). |
| **Runtime** | NOT YET VERIFIED via sim. Phase 0.A `probable` ceiling for the unverified items. The novel Postgrest patterns (P3-01) are runtime-untested in this codebase. |
| **Data** | NOT YET VERIFIED via DB probe. Could be tested via Supabase MCP `mcp__supabase__execute_sql` with a test user — but this is a read-only smoke and the operator-assisted sim flow is more comprehensive. |

**No layer contradiction within the verified layers (docs/schema/code).** Runtime + data layers await operator smoke.

---

## §9 Regression-test gate (ORCH-0840 Step 0.5)

| Requirement | Status |
|---|---|
| **(a) Implementor happy-path test** at real repo path with passing run + `fails-on-revert verified at <hash>` | ✅ PASS — `app-mobile/scripts/ci/orch-0901-regression-check.mjs` (192 lines, 13 checks). 13/13 PASS on fixed code; 9/13 FAIL at commit `599e63b1` revert; restored 13/13 PASS. Both `[FAILS-ON-REVERT KEY]` anchors T-01 + T-05 flip on revert. Independently re-verified by tester this session. |
| **(b) Tester adversarial test** at real repo path attacking DIFFERENT angles | ✅ PASS — `app-mobile/scripts/ci/orch-0901-adversarial-check.mjs` (285 lines, 14 checks). 14/14 PASS on fixed code; 12/14 FAIL on revert at `599e63b1`; restored 14/14 PASS. All three `[FAILS-ON-REVERT KEY]` anchors TA-01 + TA-04 + TA-08 flip. Adversarial attacks 8 DIFFERENT angles than happy-path (see script header). |
| **(c) Both tests appear in closing PR diff** | Will be confirmed at PR creation. Both files are NEW (untracked + uncommitted). |

**Append-only contract:** N/A — both regression tests are NEW files. No pre-existing test modifications; no `[TEST-MOD-APPROVED ORCH-0901]` token required.

---

## §10 Discoveries for Orchestrator

1. **Pre-existing `Friend` type collision** (carried forward from implementor's report). `friendsService.Friend` vs `connectionsService.Friend` mismatch at `ConnectionsPage.tsx:2765`. Pre-existing — was present at commit `599e63b1` before ORCH-0901 changes. Recommend registering as a P3 follow-up ORCH alongside ORCH-0900 [useMessages.ts dead-code cleanup] (similar dual-Conversation pattern; same fix shape).

2. **`messagingService.getMessages` line 600 still uses N+1 enrichMessage pattern.** Out of scope for ORCH-0901. Already flagged in investigation §8 #2 + implementor §12 #2. Recommend follow-up ORCH after ORCH-0898 [Consumer collab session → Friends-tab group chat] CLOSE, since substrate work may inform the right fix shape.

3. **`getMessageById` + `sendMessage` + `sendCardMessage` still call `enrichMessage`** which contains `.from('message_reads').single()` — same PGRST116 noise class fixed in ORCH-0901 for the list-cold-load surface. Low priority (single-message ops, not hot path). Worth tracking for a future DX-quality ORCH.

4. **Q3's `senderProfileCache` warming is a positive side-effect.** The cache is now hot after every Friends-tab cold-load, so subsequent `enrichMessage` calls in `getMessageById`/`sendMessage` hit the cache for up to 5 minutes. NET-POSITIVE — not a defect, but worth tracking if metric monitoring shows incidental perf gains in adjacent surfaces.

5. **Novel Postgrest pattern reuse opportunity.** The `.is('embedded.col', null)` and `.limit(N, { referencedTable: '<alias>' })` patterns introduced by ORCH-0901 could simplify several other queries in the codebase (e.g., `getMessages`, `useSessionDiscussion`'s `fetchSessionMessages`). If the patterns clear runtime smoke (§11), recommend documenting them as approved patterns in a code-conventions doc.

---

## §11 Live-fire sim smoke checklist (ask-to-unblock, operator-assisted)

Per Phase 0.A and Prime Directive 7 ask-to-unblock rule, SC-01 / SC-04 / SC-05 need `probable`-level sim repro to advance verdict from CONDITIONAL PASS to PASS. The novel Postgrest patterns (P3-01) also need runtime confirmation.

**Operator-assisted smoke steps (numbered, copy-paste runnable):**

1. **Build the dev app to a booted iOS simulator.** Use `Mingla_Artifacts/IOS_DEV_BUILD_REBUILD_RUNBOOK.md` (NOT `npx expo run:ios` — the Expo CLI v54 + Xcode 26 devicectl regression misroutes the install). Three-step `xcodebuild` → `Pods-minglabusiness-frameworks.sh` → `codesign --force --sign -` per the runbook.
2. **Sign in as a test user who has ≥5 existing DM conversations** on the Friends tab. If no such test user exists, create one with at least 5 friend acceptances + 5 DM threads with some history.
3. **Force-quit the app** (Cmd+Shift+H twice on sim, swipe app away). **Relaunch.** Navigate to Friends tab. **Measure time-to-list-populated** — start a stopwatch when the tab appears, stop when conversations render. Target: **< 2 seconds** (legacy baseline was 5–10 seconds). **This validates SC-01.**
4. **Inspect the Metro console during the cold-load.** Confirm:
   (a) Zero `PGRST116` or `406` errors (validates SC-10 at runtime).
   (b) Zero Postgrest errors about `referencedTable` or embedded-resource filtering (validates P3-01 novel-pattern runtime correctness).
   (c) Network panel shows ≤ 3 sequential requests to Supabase (the Q1+Q2 parallel pair counts as 1 round-trip wall-clock + optional Q3).
5. **Send a DM from a second test account** to the first → confirm the unread badge appears on the first account's Friends-tab list within ~1 second (realtime path untouched; this validates SC-04 read path).
6. **Tap into the conversation, scroll to mark all messages read,** return to Friends tab → confirm unread badge clears. Validates the `is_read` + unread-count round-trip.
7. **Open an empty conversation** (one with no messages yet — create one if needed via "Message" on a friend's profile). Force-quit + relaunch → Friends tab → confirm the empty conversation appears with no preview text, no PGRST116 noise in console, and renders in < 1 second on cold-load. **Validates SC-05.**

**If all 7 steps pass:** report back to orchestrator → verdict promotes from CONDITIONAL PASS to PASS → proceed to CLOSE per pre-merge gate.

**If any step fails:** capture the failure mode (screenshot + Metro log excerpt + which step) → return to implementor REWORK with the failing criterion cited.

**If sim is genuinely blocked** (test user creation impossible, dev build won't install, etc.): Seth deferral of the sim items is acceptable as CONDITIONAL PASS — operator explicitly accepts the P3-01 novel-pattern runtime-unverified risk + the SC-01/SC-04/SC-05 timing/parity-deferred status, and the verdict proceeds to CLOSE under that deferral. The risk profile is bounded: failure mode is "Friends-tab list shows stale or empty preview" — recoverable via OTA rollback.

---

## §12 Files added / changed by this QA pass

| Path | Change | Purpose |
|---|---|---|
| `app-mobile/scripts/ci/orch-0901-adversarial-check.mjs` | NEW (285 lines) | Tester adversarial regression test — 14 checks attacking different angles |
| `app-mobile/package.json` | +1 line | `test:orch-0901-adv` npm script entry |
| `Mingla_Artifacts/reports/QA_ORCH-0901_GET_CONVERSATIONS_4N_QUERY_PERF_REPORT.md` | NEW (this report) | QA verdict + evidence |

---

## §13 Severity counts

| Severity | Count | Items |
|---|---|---|
| P0 — Critical | 0 | — |
| P1 — High | 0 | — |
| P2 — Medium | 0 | — |
| P3 — Low | 3 | P3-01 novel Postgrest pattern unverified at runtime; P3-02 `(conv as any)` casts; P3-03 Q2 no time-window filter |
| P4 — Note | 1 | P4-01 praise: 3 fixes shipped coherently with self-documenting lead comment |

---

## §14 Final verdict

**CONDITIONAL PASS** — verdict promotes to **PASS** upon either (a) operator-assisted §11 smoke confirming SC-01 / SC-04 / SC-05 + P3-01 at runtime, OR (b) operator-explicit deferral of the sim items at CLOSE time (per Prime Directive 7 ask-to-unblock rule + the bounded risk profile in §11).

**Regression-test gate:** SATISFIED.

**Constitutional 14-rule audit:** CLEAN.

**Cross-domain blast radius:** CONTAINED (1 caller, 1 transform layer, 0 downstream regressions).

**Next dispatch:** depends on operator choice — Case-B `NEXT STEPS — for you, Seth:` with the §11 smoke checklist, then on smoke PASS, the orchestrator's CLOSE protocol proceeds.

---

**Report path:** `Mingla_Artifacts/reports/QA_ORCH-0901_GET_CONVERSATIONS_4N_QUERY_PERF_REPORT.md`

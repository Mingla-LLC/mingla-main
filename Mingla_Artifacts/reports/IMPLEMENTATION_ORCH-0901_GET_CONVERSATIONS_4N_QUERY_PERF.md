# IMPLEMENTATION — ORCH-0901 [Refactor `messagingService.getConversations` from 4N-sequential-queries to single JOINed query — pre-ORCH-0898 perf prerequisite]

**Skill:** Claude `mingla-implementor` (parity-mirror — operator-routed)
**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-0901_GET_CONVERSATIONS_4N_QUERY_PERF.md`
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0901_GET_CONVERSATIONS_4N_QUERY_PERF.md`
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Date:** 2026-05-20
**Status:** `implemented and verified` (structural verification via .mjs regression script; iOS sim live-fire smoke deferred — see §10)

---

## §1 Summary

Refactored `messagingService.getConversations(userId)` from a 2-query setup + 5N per-conversation loop (~52 sequential Supabase round-trips for N=10) into a 2-level RLS-filtered fetch (≤2 sequential round-trips on cold-load). The legacy NULL-sender unread bug (Investigation Finding #2) and PGRST116 `.single()` noise (Finding #3) are eliminated in the same diff. ConnectionsPage's 10-second timeout wrapper is retained as belt-and-suspenders safety net per SPEC §1.1 #7. Group-conversation-ready: no filter on `conversations.type`, so post-ORCH-0898 [Consumer collab session → Friends-tab group chat] group rows appear in the list automatically.

---

## §2 SPEC scope adaptation (operator-approved, 2026-05-20)

The SPEC's §6 prescribed jest-based regression tests at `app-mobile/src/services/__tests__/messagingService_getConversations.regression.test.ts`. Pre-flight verification surfaced that **`app-mobile` does not use jest** — no jest config, zero `*.test.ts` files under `app-mobile/src/`, 25+ existing ORCH regression tests are Node.js `.mjs` scripts under `app-mobile/scripts/ci/`. Operator approved (via AskUserQuestion 2026-05-20) adapting the SPEC's test plan to the existing `.mjs` structural-check pattern. Rationale: for a structural bug (excess query count), source-level grep is a stronger anti-regression mechanism than jest mocks because grep cannot be bypassed by mock-spy wrapping. The 10 success criteria in SPEC §4 remain unchanged.

**Adapted test path:** `app-mobile/scripts/ci/orch-0901-regression-check.mjs` (matches ORCH-0854 [Consumer ticket status live-flip] template).

---

## §3 Old → New receipts

### §3.1 `app-mobile/src/services/messagingService.ts` lines 520-595 (74 lines)

**What it did before:** Issued sequential Supabase queries in this pattern:
- Q1: `from('conversation_participants').select('conversation_id').eq('user_id', userId)` — get participation row IDs
- Q2: `from('conversations').select('*, participants:conversation_participants(*)').in('id', conversationIds).order('last_message_at', ...)` — get conversations + participants
- Per N conversations, inside a `for` loop with sequential awaits:
  - Q3-per-N: `from('messages').select('*').eq('conversation_id', conv.id).is('deleted_at', null).order(desc).limit(1).single()` — last message
  - Q4-per-N: `from('messages').select('id').eq('conversation_id', conv.id).neq('sender_id', userId).is('deleted_at', null)` — unread message IDs (the NULL-sender footgun)
  - Q5-per-N (conditional): `from('message_reads').select('message_id').in('message_id', messageIds).eq('user_id', userId)` — read-status
  - `enrichMessage` for last message → another `from('profiles')` (cached) + another `from('message_reads').single()` (PGRST116 noise on empty)
- Total: ~52 sequential round-trips for N=10 cold-load.

**What it does now:** Issues at most 2 sequential round-trips:
- Q1 + Q2 run in parallel via `Promise.all([conversationsPromise, unreadPromise])`:
  - **Q1:** `from('conversations').select('*, participants:conversation_participants(...), last_message:messages(..., read_status:message_reads(user_id))').is('last_message.deleted_at', null).order('last_message_at', ...).order('created_at', { referencedTable: 'last_message', ... }).limit(1, { referencedTable: 'last_message' })` — single nested-JOIN that returns conversations + participants + most-recent message (with embedded read_status) per conversation. RLS policy `Users can view conversations they participate in` (baseline migration line 14966) filters automatically.
  - **Q2:** `from('messages').select('id, conversation_id, message_reads(user_id)').or('sender_id.neq.${userId},sender_id.is.null').is('deleted_at', null)` — single unread helper that defeats the `.neq()` nullable-column footgun (NULL-sender system messages now correctly count as unread).
- Q3 (conditional, sequential after Q1): `from('profiles').select('id, display_name, ...').in('id', Array.from(senderIds))` — batch profile fetch for unique last-message senders. Warms `senderProfileCache` so subsequent reads hit the cache.
- TS-only assembly loop: builds the `Conversation[]` array from the joined data + unread map + cached sender names + computed `is_read` (from embedded `read_status`). **Zero Supabase calls inside the loop.**

**Why:**
- SPEC SC-01 (cold-load < 2.0s for N=20): ~52 round-trips → ≤3 round-trips
- SPEC SC-02 (≤ 2 sequential round-trips): Q1+Q2 parallel; Q3 sequential after; matches contract
- SPEC SC-03 (return-shape preservation): `Conversation` interface unchanged; TypeScript strict passes; no consumer changes required
- SPEC SC-07 (group-conversation-ready): zero filter on `conversations.type`, so future ORCH-0898 `type='group'` rows appear automatically
- SPEC SC-08 (NULL-sender unread fix): `.or('sender_id.neq.${userId},sender_id.is.null')` — system messages count as unread
- SPEC SC-10 (PGRST116 noise eliminated): no `.single()` calls in the new body; the embedded JOIN returns `null`/`undefined` cleanly when last_message is absent
- Investigation Finding #1 root cause addressed
- Investigation Findings #2 + #3 hidden flaws eliminated in same diff

**Lines changed:** 75 lines (the entire `getConversations` body, including a 13-line lead comment that names the structural invariant + cross-references the regression-check script).

### §3.2 `app-mobile/src/components/ConnectionsPage.tsx` lines 693-696 (5 lines, comment-only)

**What it did before:** Inline comment stated: "Hard 10-second timeout: messagingService.getConversations runs 4N sequential Supabase queries with no built-in timeout. When the app returns from background, the OS suspends inflight connections and Supabase hangs silently — the finally block would never fire, leaving conversationsLoading stuck at true forever."

**What it does now:** Inline comment states: "Hard 10-second timeout: belt-and-suspenders safety net. Post-ORCH-0901, messagingService.getConversations runs at most 2 sequential RLS-filtered Supabase round-trips (Q1+Q2 in parallel + optional Q3 batch-profile-fetch) — down from the ~5N+3 sequential queries it used to run — but background-suspended connections can still hang any single round-trip, and the timeout prevents conversationsLoading from getting stuck at true forever. See SPEC_ORCH-0901 §3.2."

**Why:** SPEC §3.2 — comment-only update so the in-code documentation reflects the post-ORCH-0901 query shape; the 10s `Promise.race` itself (lines 697-703) is preserved as belt-and-suspenders per SPEC SC-09.

**Lines changed:** 6 lines (4-line block replaced with 6-line block).

### §3.3 `app-mobile/scripts/ci/orch-0901-regression-check.mjs` (NEW — 192 lines)

**What it does:** Structural regression check, 13 PASS-or-FAIL assertions. Runs via `node app-mobile/scripts/ci/orch-0901-regression-check.mjs` and via `npm run test:orch-0901`. Exit 0 on full PASS, exit 1 on any FAIL. Implements SPEC §6.1 happy-path test plan adapted to the .mjs convention.

| Check | Maps to |
|---|---|
| T-01 [FAILS-ON-REVERT KEY] | SC-02 — count of `supabase.from(` ≤ 3 in body |
| T-01b | SC-02 — count of `await supabase.from(` ≤ 1 (Q3 only) |
| T-02 | SC-03 — `Conversation` interface unchanged |
| T-05 [FAILS-ON-REVERT KEY] | SC-08 — NULL-sender `.or()` predicate present |
| T-05b | SC-08 — legacy `.neq('sender_id', userId)` eliminated |
| T-06 | SC-07 — no `.eq('type', 'direct')` filter |
| T-07 | SC-10 — no `.single()` in body |
| T-08 | Constitution #3 — error path preserved |
| T-09 | SC-02 — `Promise.all([conversationsPromise, unreadPromise])` present |
| Q1 shape check | SC-02 — embedded participants + last_message + read_status JOIN structure |
| ConnectionsPage comment | SPEC §3.2 — comment updated |
| SC-09 | 10-second `Promise.race` timeout retained |
| Contract check | sender_name + is_read still populated on last_message |

### §3.4 `app-mobile/package.json` (1 line added)

Added `"test:orch-0901": "node ./scripts/ci/orch-0901-regression-check.mjs"` in the scripts section.

---

## §4 Spec traceability matrix

| Spec criterion | Implementation evidence | Verification |
|---|---|---|
| **SC-01** Cold-load < 2.0s for N=20 | Q1+Q2 parallel via Promise.all + optional Q3 batch profile fetch — at most 3 round-trips. Network-bound estimate: ~3 × 100ms = ~300ms typical. | `unverified` via iOS sim live-fire (deferred — see §10). Structural invariant verified by T-01 + T-01b + T-09. |
| **SC-02** ≤ 2 sequential Supabase round-trips | Q1 + Q2 in `Promise.all` (level 1); Q3 conditional after (level 2). | `passed` — T-01 + T-01b + T-09 regression check PASS. |
| **SC-03** Return-shape unchanged | `Conversation` interface at line 211 untouched. TypeScript strict accepts the new code with zero new errors. | `passed` — T-02 + tsc filter on touched files (zero new errors). |
| **SC-04** Solo/DM parity | Refactor preserves DM behavior — same return shape, same error contract, same caller-side transform. | `unverified` via sim live-fire (deferred — see §10). Code-level parity preserved by SC-03. |
| **SC-05** Empty state < 200ms | Empty case: Q1 returns `[]`, Q2 returns `[]`, Q3 not invoked (senderIds.size === 0), assembly loop emits `[]`. Pure-JS path, near-instant after the 2 parallel round-trips return. | `unverified` via live-fire; structurally correct by code-read. |
| **SC-06** Orphaned-participant resilience | Cached sender lookup is null-safe (`cachedSender?.name ?? (lastMessageRaw.sender_id ? 'Unknown' : 'Deleted User')`). Missing profile row → 'Unknown' fallback. No crash. | `passed` — code-read; null-guard verified inline. |
| **SC-07** Group-conversation-ready | No filter on `conversations.type` in any of Q1/Q2/Q3. Schema's pre-installed `type='direct'|'group'` value (baseline migration line 8013) flows through. | `passed` — T-06 regression check PASS. |
| **SC-08** NULL-sender unread fix | Q2 uses `.or('sender_id.neq.${userId},sender_id.is.null')` — captures both real-other-user and system NULL-sender messages. | `passed` — T-05 + T-05b regression check PASS. |
| **SC-09** 10-second timeout retained | `ConnectionsPage.tsx` lines 697-703 unchanged. | `passed` — regression check confirms `setTimeout(...new Error('getConversations timed out after 10s'))` still present at the expected location. |
| **SC-10** PGRST116 noise eliminated | Zero `.single()` calls in the new `getConversations` body. The embedded JOIN handles empty cases naturally. | `passed` — T-07 regression check PASS. |

---

## §5 Invariant verification

| Invariant | Status | Evidence |
|---|---|---|
| **I-PROPOSED-J** (Zustand persist holds IDs, not server records) | PRESERVED | No Zustand state introduced. `ConnectionsPage` retains its `useState<Conversation[]>` model. |
| **I-SUPABASE-NEQ-NULL-DISCIPLINE** | PRESERVED + NEW INVARIANT ENFORCEMENT | T-05 + T-05b regression checks lock the `.or()` pattern. |
| **I-RLS-RETURNING-OWNER-GAP-MITIGATION** | PRESERVED | No new RLS policies. No SECURITY DEFINER helpers added. New queries rely on existing inline-EXISTS policies (baseline migration lines 14966+). |
| **Solo/DM parity** | PRESERVED | Return shape unchanged; DM-side consumers (ConnectionsPage + ChatListItem) untouched in scope. |
| **Append-only test contract** | PRESERVED | New file at `app-mobile/scripts/ci/orch-0901-regression-check.mjs` — no existing tests modified. |
| **Constitution #2** (One owner per truth) | PRESERVED | `messages` remains the canonical store; React Query / useState consumers unchanged. |
| **Constitution #3** (No silent failures) | PRESERVED | Error path preserved — `try`/`catch` returns `{ conversations: [], error: error.message }` (T-08 verifies). PGRST116 noise eliminated. |
| **I-FRIENDS-TAB-COLD-LOAD-UNDER-2S** (NEW, DRAFT) | INTRODUCED | T-01 + T-01b structural enforcement; flips ACTIVE on ORCH-0901 CLOSE. |

---

## §6 Cross-Surface Impact

| Surface | Touched? | Result |
|---|---|---|
| **Consumer iOS** (`app-mobile/` on iOS) | YES (primary) | Friends-tab DM list cold-load shape: ~5N+3 → ≤3 round-trips. Render output identical. |
| **Consumer Android** (`app-mobile/` on Android) | YES (parity) | Same as iOS — shared RN code, automatic parity. |
| **Buyer-anon Web** | NO | No Friends tab there. |
| **Business iOS / Android / web-preview** | NO | No consumer messaging surface. |
| **Admin Web** | NO | No consumer messaging surface. |

Parity is automatic (shared RN code in `app-mobile/`). No manual per-platform code paths.

---

## §7 Cache safety

- React Query keys: no changes. ConnectionsPage uses `useState` for conversations, not React Query. No invalidation impact.
- AsyncStorage cache: `getConversationsCacheKey(userId)` versioned via `CONNECTIONS_CACHE_VERSION` constant in ConnectionsPage. The cached `Conversation[]` shape is unchanged (server-shape preserved per SC-03), so existing cached entries from prior app sessions remain valid — no cache bust needed.
- `senderProfileCache` (private Map on MessagingService instance): now warmed by Q3 batch fetch instead of N sequential `getSenderName` calls. TTL unchanged (5 min). Same cache shape; no consumer-facing impact.

---

## §8 Regression test (Step 0.5 gate per ORCH-0840)

### §8.1 Implementor happy-path test

**Path:** `app-mobile/scripts/ci/orch-0901-regression-check.mjs`
**Run command:** `node app-mobile/scripts/ci/orch-0901-regression-check.mjs` OR `cd app-mobile && npm run test:orch-0901`

**Latest run output (against the fixed code):**
```
ORCH-0901 regression check (happy-path, structural)

  [PASS] T-01 [FAILS-ON-REVERT KEY] getConversations body contains ≤ 2 sequential `supabase.from(` invocations
  [PASS] T-01b Sequential `await supabase.from(` count in getConversations body is ≤ 1
  [PASS] T-02 Conversation interface still declares { id, type, created_by, created_at, updated_at, last_message_at?, participants[], last_message?, unread_count? }
  [PASS] T-05 [FAILS-ON-REVERT KEY] Unread-count predicate uses .or('sender_id.neq.<X>,sender_id.is.null')
  [PASS] T-05b Legacy .neq('sender_id', userId) does NOT appear in getConversations body
  [PASS] T-06 No `.eq('type', 'direct')` filter on conversations.type in getConversations body
  [PASS] T-07 No `.single()` call appears in getConversations body
  [PASS] T-08 Error path returns `{ conversations: [], error: error.message }`
  [PASS] T-09 Q1+Q2 run in parallel via Promise.all
  [PASS] Q1 shape: conversations.select() embeds participants:conversation_participants + last_message:messages + nested read_status:message_reads
  [PASS] ConnectionsPage:693 comment updated to reflect post-ORCH-0901 query count
  [PASS] SC-09: 10-second `Promise.race` timeout retained at ConnectionsPage:697-703
  [PASS] Contract: last_message still gets sender_name + is_read populated before return

Summary: 13/13 PASS
```
Exit code: 0.

### §8.2 Fails-on-revert verification

**Procedure:** `git stash push -- app-mobile/src/services/messagingService.ts app-mobile/src/components/ConnectionsPage.tsx` to revert ORCH-0901 changes → re-run regression script → confirm FAIL → `git stash pop` → re-run → confirm PASS.

**Commit hash before fix (revert state):** `599e63b1` (HEAD before any ORCH-0901 changes — confirmed via `git rev-parse HEAD` while stashed).

**Output against reverted (legacy) code:**
```
Summary: 4/13 PASS (9 FAIL)
```
Exit code: 1.

**Failing checks on revert (9 total):**
- T-01 [FAILS-ON-REVERT KEY] — legacy body contains 5 `supabase.from(` invocations (>3 limit)
- T-01b — legacy body contains 5 `await supabase.from(` invocations (>1 limit)
- T-05 [FAILS-ON-REVERT KEY] — `.or('sender_id.neq.…,sender_id.is.null')` absent in legacy
- T-05b — legacy still contains `.neq('sender_id', userId)`
- T-07 — legacy contains `.single()` on lines 558 + 951
- T-09 — legacy has no `Promise.all([conversationsPromise, unreadPromise])`
- Q1 shape check — legacy has no `last_message:messages` or `read_status:message_reads` aliases
- ConnectionsPage comment check — legacy still says "4N sequential"
- Contract check — legacy populates sender_name via `enrichMessage`, not via cached lookup

Both `[FAILS-ON-REVERT KEY]` anchors (T-01 + T-05) FAIL on revert, satisfying ORCH-0840 Step 0.5.

**Output against restored fix:**
```
Summary: 13/13 PASS
```
Exit code: 0.

Both transitions verified live in the working tree this turn.

### §8.3 Test mod token

No pre-existing tests modified. No `[TEST-MOD-APPROVED ORCH-0901]` token needed in the closing commit body.

---

## §9 TypeScript verification

Project-wide tsc filter on touched files:

```
npx tsc --noEmit | grep -E "(messagingService|ConnectionsPage)\.tsx?\("
```

Result:
- `app-mobile/src/services/messagingService.ts` — **zero errors** (my changes type-clean against strict mode)
- `app-mobile/src/components/ConnectionsPage.tsx` — 1 pre-existing error at line 2765 (`Friend` type mismatch between `friendsService.Friend` and `connectionsService.Friend` — unrelated to ORCH-0901; was present in HEAD before my changes; out of scope)

**Zero new tsc errors introduced by ORCH-0901.**

---

## §10 Verification status by criterion

| Criterion | Status | Evidence |
|---|---|---|
| SC-01 cold-load < 2s for N=20 | **`unverified`** | Live-fire sim smoke deferred (see §10.1). Structural invariant proves the round-trip count; absolute timing requires a real test user with N=20 conversations on a representative network — which the operator owns. |
| SC-02 ≤ 2 sequential round-trips | **`passed`** | T-01 + T-01b + T-09 PASS structurally. |
| SC-03 return-shape preserved | **`passed`** | T-02 + zero new tsc errors. |
| SC-04 DM parity | **`unverified`** | Live-fire sim smoke deferred. Code-level shape preservation locks this — but a real DM send/receive/react/read round-trip should be smoke-tested by operator. |
| SC-05 empty state < 200ms | **`unverified`** | Live-fire sim deferred. Code-read confirms early-return path. |
| SC-06 orphaned-participant resilience | **`passed`** | Code-read; null-safe fallback to 'Unknown'. |
| SC-07 group-conversation-ready | **`passed`** | T-06 PASS. |
| SC-08 NULL-sender unread fix | **`passed`** | T-05 + T-05b PASS. |
| SC-09 10s timeout retained | **`passed`** | Regression check + manual diff inspection. |
| SC-10 PGRST116 noise eliminated | **`passed`** | T-07 PASS. |

### §10.1 Live-fire sim smoke deferral

SC-01 cold-load timing and SC-04/SC-05 DM behavioral parity require a real test account on a representative network. I attempted neither in this implementation pass — the implementation deliverable is structural correctness + regression-test PASS + fails-on-revert proof, which is unblocked. The operator is the right party to smoke-test on iOS sim + Android emu before TEST mode runs.

**Operator smoke checklist:**
1. Build the dev app to a booted iOS simulator (use `Mingla_Artifacts/IOS_DEV_BUILD_REBUILD_RUNBOOK.md`).
2. Sign in as a test user who has ≥5 DMs on the Friends tab.
3. Cold-load: force-quit + relaunch → open Friends tab → measure time-to-list-populated (target < 2s).
4. Send a DM from a second account → confirm the first account sees it via realtime + unread badge updates.
5. Mark messages as read → confirm unread badge clears.
6. Confirm no PGRST116 / 406 errors in Metro console during cold-load.

If the operator wants tester to run this instead, dispatch Claude `mingla-forensics` (TEST mode) per the handoff in §13 — the tester is fully authorized to drive Maestro + smoke-test as part of their PASS/FAIL verdict per `feedback_tester_canonical_and_platform_parity.md`.

---

## §11 Regression surface (adjacent features the tester should check)

1. **DM send + receive + realtime updates** — `messagingService.sendMessage` was not touched, but it shares the `messages` table with `getConversations`. Tester should confirm DM send/receive round-trip is unchanged.
2. **DM read-receipts** — `markAsRead` was not touched. Tester should confirm marking-as-read still clears unread badges on the Friends-tab list.
3. **Shared-card messages (ORCH-0667)** — `card_payload` is included in the Q1 select. Tester should confirm shared cards still render in the chat list preview.
4. **Image / file / video DMs** — `message_type` and `file_url`/`file_name`/`file_size` are included in Q1. Tester should confirm preview text shows correctly for non-text message types.
5. **Conversation creation** — `getOrCreateDirectConversation` was not touched. New DM creation flow should be unchanged.
6. **Background-return resilience** — the 10-second timeout is retained at ConnectionsPage:697-703. Tester can verify by backgrounding the app for 30s, returning, and confirming the Friends tab still loads (or falls back to cached state gracefully).

---

## §12 Discoveries for Orchestrator

1. **Pre-existing tsc error at `ConnectionsPage.tsx:2765`** — `Friend` type from `friendsService` is not assignable to `Friend` type from `connectionsService`. There are TWO `Friend` interfaces in the codebase (analogous to the dual `Conversation` situation that ORCH-0900 [useMessages dead-code cleanup] partially addresses). Pre-existing, not introduced by ORCH-0901, but worth registering as a P3 follow-up similar to ORCH-0900.

2. **`messagingService.getMessages` (line 600) still uses the N+1 enrichMessage loop pattern** — Investigation §8 Discovery #2 flagged this; out of scope for ORCH-0901. Recommend registering as a follow-up ORCH after ORCH-0898 CLOSE, since the substrate work may inform the right fix shape.

3. **`getMessageById` and `sendMessage` still call `enrichMessage`** which does `from('message_reads').single()` — same PGRST116 noise pattern as fixed in `getConversations`. Low priority (single-message lookups, not hot path), but worth noting for a future cleanup ORCH.

4. **Q2 unread helper has no time-window filter** — currently fetches ALL non-self / NULL-sender messages from ALL conversations the user participates in. RLS gates the scope, but for very active users (100+ conversations × 1000+ messages each), payload could grow. Recommend monitoring + adding a `created_at > NOW() - INTERVAL '90 days'` filter in a future ORCH if needed. For typical users (N≤20, M≤100), payload is small.

5. **`enrichMessage` private method is still used** by `getMessageById`, `sendMessage`, and `sendCardMessage` — kept intact. The `senderProfileCache` is also warmed by the new Q3 batch fetch in `getConversations`, so subsequent `enrichMessage` calls on the same senders within 5 min hit the cache. Net effect: future `getMessageById`/`sendMessage` calls are slightly faster on warm cache. No deprecation needed.

---

## §13 Files changed (final)

| Path | Change | Lines |
|---|---|---|
| `app-mobile/src/services/messagingService.ts` | Refactored `getConversations` body | ~75 lines replaced |
| `app-mobile/src/components/ConnectionsPage.tsx` | Updated lines 693-696 comment | 6 lines |
| `app-mobile/scripts/ci/orch-0901-regression-check.mjs` | NEW regression test | 192 lines |
| `app-mobile/package.json` | Added `test:orch-0901` script | 1 line |

Total: 4 files, ~274 LoC changed.

---

## §14 EAS OTA + deploy notes

- **EAS OTA: ELIGIBLE.** Pure JavaScript/TypeScript change. No native module change. No new dependency. No migration.
- **DB push: NOT required.** No schema changes.
- **Edge function deploy: NOT required.** No edge function changes.
- **Migration: NOT required.**

Post-CLOSE OTA command (for orchestrator CLOSE protocol Step 3):
```bash
cd app-mobile && eas update --branch production --platform ios,android --message "ORCH-0901: getConversations single-JOIN refactor"
```

---

## §15 Constitutional compliance

| # | Rule | Status |
|---|---|---|
| 1 | No dead taps | N/A (no UI changes) |
| 2 | One owner per truth | PASS — `messages` remains canonical; no new data owners |
| 3 | No silent failures | PASS — error path returns `{ conversations: [], error: error.message }`; PGRST116 noise eliminated |
| 4 | One key per entity | N/A (no React Query keys touched) |
| 5 | Server state server-side | PASS — no Zustand introduced |
| 6 | Logout clears everything | PASS — `senderProfileCache` is per-instance, gets garbage-collected with the service; no persisted user data added |
| 7 | Label temporary | N/A (no transitional code introduced) |
| 8 | Subtract before adding | PASS — legacy 2+5N loop fully removed before adding new query shape |
| 9 | No fabricated data | PASS — orphaned-participant fallback explicitly labels 'Unknown' / 'Deleted User'; no fake counts |
| 10 | Currency-aware UI | N/A (no currency-related code) |
| 11 | One auth instance | N/A (no auth changes) |
| 12 | Validate at right time | N/A (no datetime logic) |
| 13 | Exclusion consistency | PASS — `is('deleted_at', null)` consistently applied to both Q1's embedded last_message AND Q2's unread helper |
| 14 | Persisted-state startup | N/A (no persisted client state added) |

All applicable rules PASS. No violations.

---

**Report path:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0901_GET_CONVERSATIONS_4N_QUERY_PERF.md`
**Status:** `implemented and verified` (structurally + via regression test; live-fire smoke deferred to operator or tester).

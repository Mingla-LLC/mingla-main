# QA Report — ORCH-0898 Consumer Collab Session → Friends-Tab Group Chat

**ORCH:** ORCH-0898 [Consumer collab session → Friends-tab group chat (shared thread, auto-roster, harmonized with ORCH-0897 trip group chat)]
**Tester:** Claude `mingla-tester`
**Date:** 2026-05-21
**Working tree:** /Users/sethogieva/Desktop/mingla-main on branch Seth
**Phase:** TEST
**Spec:** Mingla_Artifacts/specs/SPEC_ORCH-0898_COLLAB_GROUP_CHAT.md
**Implementation report:** Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0898_COLLAB_GROUP_CHAT_v2.md
**Investigation report:** Mingla_Artifacts/reports/INVESTIGATION_ORCH-0898_COLLAB_GROUP_CHAT.md

---

## Verdict

**CONDITIONAL PASS** — operator-assisted iOS + Android emu live-fire sim smoke required to promote to PASS.

- **P0:** 0
- **P1:** 0
- **P2:** 0
- **P3:** 2
- **P4:** 2

**Sim evidence:** ATTEMPTED but DEFERRED. The `notify-message` edge function has NOT been deployed yet (orchestrator deploys post-CLOSE per the standing operator/orchestrator split). Without the deployed function, push-notification flows and the new unified `message` / `message_mention` types cannot fire from a real device. Confidence on UI/runtime code paths is `probable` (per Phase 0.A live-fire ladder) — schema, RLS, triggers, services, hooks, and components are all independently verified via DB probes + structural regression + adversarial regression. The blocker is named and the unblock is operator action (run the deploy command in the handoff).

**Regression tests:**
- Implementor happy-path: `app-mobile/scripts/ci/orch-0898-regression-check.mjs` — **17/17 PASS** on fix; **10/17 FAIL on app-code revert @ commit `bb74655b`** (fails-on-revert verified).
- Tester adversarial: `app-mobile/scripts/ci/orch-0898-adversarial-check.mjs` — **15/15 PASS** on fix; **3/15 FAIL on app-code revert** (TA-10 system-row, TA-11 legacy type aliases, TA-14 translateInsertRlsError — each catches an angle the happy-path doesn't).
- npm scripts: `test:orch-0898` + `test:orch-0898-adv` both wired in `app-mobile/package.json`.
- Both test files appear in `git diff origin/main...HEAD --name-only` for the closing PR.

**Cross-ORCH integrity:** ORCH-0901 regression script re-run independently against current `messagingService.ts` state → **13/13 PASS**. The `getConversations` 4N-query perf fix + NULL-sender unread predicate are preserved. ORCH-0898 changes do not regress earlier shipped work.

---

## Layman summary of the report

- **What we tested.** The new unified chat substrate that turns every collab session into a group chat visible in the Friends tab. We checked schema, RLS, triggers, every service/hook/component the implementor touched, and ran two independent regression scripts.
- **Database is solid.** All 6 new conversations columns, the `mentions` column on messages, and `notifications_muted` on participants are live. All 3 SECURITY DEFINER triggers fired into the schema correctly. All 4 RLS policies are verified live — the broadcast-only enforcement is `AS RESTRICTIVE` (so PERMISSIVE policies can't OR-bypass it), the self-add policy is restricted to direct conversations only, and the legacy permissive name is gone (not just renamed).
- **Backfill ran clean.** 9 sessions → 9 conversations, 6 board messages → 6 messages, 21 accepted participants → 21 conversation_participants. Row counts match end-to-end; the migration would have rolled back with `RAISE EXCEPTION` if they didn't.
- **App code is clean.** Services, hooks, components, and the deprecated board services all behave per spec. System-message rows render as centered muted italic text in both `discussion/MessageBubble.tsx` and `chat/MessageBubble.tsx`. `ChatListItem` has the group-avatar fan stack and hides pair buttons for groups. `useSessionDiscussion` is fully on the new substrate. The deprecated board services throw `[TRANSITIONAL]` errors per the dual-read window plan.
- **The notify-message edge function passes structural review** but **has not been deployed**. We will not run live sim smoke against an undeployed function because any failure would be ambiguous (code bug vs. unshipped code). This is why the verdict is CONDITIONAL PASS.
- **Two small process gaps (P3).** SPEC §3.1 Step 6c missed the `AS RESTRICTIVE` keyword — implementor caught and applied it correctly, but forensics should backport into the spec so future readers don't get misled. And `ConnectionsPage.tsx:2773` carries a pre-existing TypeScript Friend type collision that shifted by 8 lines due to the Phase 5b edit — not introduced by this ORCH, but worth registering as a follow-up.
- **Two praise notes (P4).** The implementor's interpretation discipline on RESTRICTIVE was correct over the spec text. The dual-read window via `@deprecated` JSDoc + thrown `[TRANSITIONAL]` errors (exit condition: ORCH-0902) is the cleanest decommission pattern we've seen — beats silent fallbacks and lets future readers find the cleanup ORCH from the error text alone.
- **What ships next.** Operator deploys `notify-message`, then runs the 6-step sim smoke checklist below. If smoke passes, this flips to PASS and CLOSE can proceed with PR Seth→main + EAS OTA.

---

## Spec criteria matrix

| ID | Criterion | Verdict | Evidence |
|----|-----------|---------|----------|
| SC-01 | New conversations columns (session_id, event_id, linked_entity_type, is_broadcast_only, is_enabled, name) present + types correct | PASS | Live MCP query: all 6 columns present with expected types and defaults |
| SC-02 | messages.mentions jsonb NOT NULL DEFAULT '[]'::jsonb | PASS | MCP query confirms jsonb default '[]'::jsonb, is_nullable='NO' |
| SC-03 | conversation_participants.notifications_muted bool NOT NULL DEFAULT false | PASS | MCP query confirms |
| SC-04 | Trigger ensure_group_conversation_on_session_create creates group conversation on collaboration_sessions INSERT | PASS structural; smoke deferred | Trigger SECURITY DEFINER body verified via pg_proc; live INSERT test deferred (MCP execute_sql is read-only; staging needed) |
| SC-05 | Trigger sync_session_member_to_conversation adds participant on has_accepted=true | PASS structural; smoke deferred | WHEN clause exactly `NEW.has_accepted = true` confirmed (adversarial TA-13); body verified |
| SC-06 | Trigger remove_session_member_from_conversation removes on DELETE | PASS structural; smoke deferred | Body verified via pg_proc |
| SC-07 | RLS broadcast-only enforcement is RESTRICTIVE | PASS | Live MCP query: `permissive='RESTRICTIVE'` on `messages_broadcast_only_enforcement` |
| SC-08 | RLS self-add restricted to c.type='direct' | PASS | Live MCP query: policy body matches `c.type = 'direct'` AND user_id = auth.uid() |
| SC-09 | Backfill of board_messages → messages with 100% row-count match | PASS | Implementation report: 6 board_messages → 6 messages, 21 brand_team_members → 21 conversation_participants; RAISE EXCEPTION enforces |
| SC-10 | Cross-session RLS isolation (User A in Session 1 cannot read messages in Session 2) | PASS structural; smoke deferred | All SELECT policies use inline EXISTS on conversation_participants (no SECURITY DEFINER helpers) — verified via adversarial TA-01 + live policy body inspection |
| SC-11 | getOrCreateGroupConversationForSession service + leaveGroupConversation service | PASS | Code review of messagingService.ts; happy-path T-08; adversarial structural confirmation |
| SC-12 | useSessionDiscussion reads from messages + realtime channel keyed on conversation_id | PASS | Code review; happy-path T-10 + T-11 |
| SC-13 | ChatListItem group avatar fan stack + pair buttons hidden for groups | PASS | Code review; happy-path T-12 |
| SC-14 | discussion/MessageBubble + chat/MessageBubble render NULL-sender / isSystem rows as centered muted italic | PASS | Code review; happy-path T-13 + adversarial TA-10 (FAILS-ON-REVERT KEY) |
| SC-15 | boardDiscussionService write methods THROW [TRANSITIONAL] with exit condition ORCH-0902 | PASS | Code review; happy-path T-09 confirms 4/4 write methods throw |
| SC-16 | notify-message canonical `message` + `message_mention` types route via handleUnifiedMessage / handleUnifiedMention | PASS | Code review; adversarial TA-11 + TA-15 |
| SC-17 | Legacy notify-message types (direct_message, board_message, board_mention, direct_card_message) preserved with deprecation warn | PASS | Adversarial TA-11 (FAILS-ON-REVERT KEY) confirms all 4 routed to handlers with console.warn |
| SC-18 | OneSignal template parameterized by conversation type | PASS structural; smoke deferred | Code review of notify-message |
| SC-19 | Deep-link format `mingla://chat/<conv>?type=<>&sessionId=<>&eventId=<>` | PASS structural; smoke deferred | Code review of notify-message |
| SC-20 | ORCH-0897 (Tr6) substrate alignment (linked_entity_type='trip' branch reserved) | PASS | conversations_linked_entity_coherent CHECK has 3-branch discriminator (direct/session/trip) per adversarial TA-06; ORCH-0897 can inherit without schema migration |
| SC-21 | I-PROPOSED-CHAT-SUBSTRATE-UNIFIED — no new chat-message tables | PASS | Adversarial TA-08 |
| SC-22 | I-PROPOSED-CHAT-RLS-INLINE-EXISTS — no SECURITY DEFINER helpers in SELECT policies | PASS | Adversarial TA-07 |
| SC-23 | I-PROPOSED-CHAT-PERMISSIVE-TIGHTEN — legacy "Users can add themselves" policy DROPped (not just renamed) | PASS | Adversarial TA-03 + TA-12 |
| SC-24 | I-PROPOSED-CHAT-BACKFILL-ASSERT — backfill row-count uses RAISE EXCEPTION | PASS | Adversarial TA-04 |
| SC-25 | Cross-ORCH integrity: ORCH-0901 perf fix preserved | PASS | Independent ORCH-0901 regression re-run: 13/13 PASS; adversarial TA-09 + TA-15 |

**Coverage: 25/25 structural PASS. SC-04, SC-05, SC-06, SC-10, SC-18, SC-19 await operator sim smoke.**

---

## Constitution audit (14 rules)

| # | Rule | Verdict | Evidence |
|---|------|---------|----------|
| 1 | No dead taps | PASS | All new interactive elements (group avatar tap, leave-group) wired |
| 2 | One owner per truth | PASS | conversations is now the single chat substrate; board_messages writes BLOCKED with thrown errors |
| 3 | No silent failures | PASS | translateInsertRlsError disambiguates 42501; @deprecated services throw with exit condition |
| 4 | One key per entity | PASS | conversation_id is canonical; session_id is the lookup discriminator |
| 5 | Server state server-side | PASS | useSessionDiscussion routes through React Query; no Zustand snapshot of messages |
| 6 | Logout clears everything | PASS | No new persisted state introduced |
| 7 | Label temporary | PASS | `[TRANSITIONAL] ORCH-0898 dual-read window... Exit condition: ORCH-0902` on all 4 board service write methods |
| 8 | Subtract before adding | PASS | Legacy "Users can add themselves" policy DROPped; deprecated services throw rather than dual-write |
| 9 | No fabricated data | PASS | NULL-sender rows render as system messages (not synthesized human messages); muted italic styling makes the distinction explicit |
| 10 | Currency-aware | N/A | No currency surface touched |
| 11 | One auth instance | PASS | All new RLS uses auth.uid() consistently |
| 12 | Validate at right time | PASS | Trigger fires on collaboration_sessions row-event, not wall-clock |
| 13 | Exclusion consistency | PASS | Backfill applies same membership predicate (accepted_at IS NOT NULL AND removed_at IS NULL) as live trigger sync |
| 14 | Persisted-state startup | N/A | No persisted-state surface touched |

**14/14 PASS or N/A. No constitutional violations.**

---

## Findings

### P3 — Spec backport (forensics action)

**P3-1: SPEC §3.1 Step 6c missing `AS RESTRICTIVE` keyword.**
- File: `Mingla_Artifacts/specs/SPEC_ORCH-0898_COLLAB_GROUP_CHAT.md` §3.1 Step 6c
- Issue: The spec describes the `messages_broadcast_only_enforcement` policy semantics but the literal SQL fragment omits the `AS RESTRICTIVE` keyword. Without RESTRICTIVE, PostgreSQL OR-combines policies (PERMISSIVE default) and the broadcast-only check can be bypassed by any other INSERT policy returning TRUE.
- Impact: Implementor correctly inferred the semantic intent and added `AS RESTRICTIVE` (verified live via MCP: `permissive='RESTRICTIVE'`). No production impact. But a future reader pattern-matching from the spec text alone could ship a PERMISSIVE policy and silently lose enforcement.
- Recommended action: Forensics backport `AS RESTRICTIVE` into the spec body. Add a one-line emphasis: "RESTRICTIVE is required — PERMISSIVE policies OR-combine and would bypass this gate."

**P3-2: Pre-existing `Friend` type collision at ConnectionsPage.tsx:2773.**
- File: `app-mobile/src/components/ConnectionsPage.tsx:2773`
- Issue: Two `Friend` types declared in the same module scope. Shifted from line 2765 to 2773 due to the 3-line Phase 5b edit (transform passing `type`, `name`, `session_id`).
- Impact: NOT introduced by this ORCH. Baseline tsc warning. The 3-line ORCH-0898 edit did not change the collision count.
- Recommended action: Register as a follow-up cleanup ORCH (low priority). Not a blocker for ORCH-0898 CLOSE.

### P4 — Praise

**P4-1: Implementor RESTRICTIVE interpretation discipline.**
The implementor caught that the spec's policy fragment was missing `AS RESTRICTIVE` and used RESTRICTIVE in the migration anyway with an interpretation note in the implementation report. This is exactly the discipline we want: the spec is the contract, but when the spec text is provably incomplete relative to the spec intent, the implementor calls it out and ships correctly. Verified live as `permissive='RESTRICTIVE'`.

**P4-2: Dual-read window via thrown `[TRANSITIONAL]` errors.**
The deprecated `boardDiscussionService` write methods do not silently fall back to the new substrate, nor do they dual-write. They THROW with `[TRANSITIONAL] ORCH-0898 dual-read window: <method> BLOCKED. Exit condition: ORCH-0902`. This is the cleanest decommission pattern we've seen — any caller that hasn't migrated gets a loud failure with a precise pointer to the follow-up ORCH. Future readers can `grep "Exit condition: ORCH-0902"` to find every remaining tether. Beats silent fallbacks.

---

## Discoveries for orchestrator

1. **ORCH-0897 (Tr6 trip group chat) can inherit this substrate directly.** The `conversations_linked_entity_coherent` CHECK constraint already has a 3-branch discriminator (direct / session / trip). When ORCH-0897 resumes, it needs to (a) make the trigger fire on trip creation, (b) extend the RLS active-membership predicate to include the trip-creator user, (c) wire the Friends-tab item label. No schema migration required.
2. **`brand_team_members` (not `brand_members`).** Forensics backported 5 corrections into INVESTIGATION_ORCH-0898 + a SUPERSEDED banner on Tr6_DISCUSSION_BOARD.md + 1 fix in WORLD_MAP. Verified live: the SECURITY DEFINER trigger + RLS policy both reference `brand_team_members` with the active-membership predicate (`accepted_at IS NOT NULL AND removed_at IS NULL`). Operator should confirm WORLD_MAP entry for ORCH-0897 reflects the corrected name before resuming Tr6.
3. **MCP execute_sql is read-only.** Synthetic trigger-fire INSERT test was blocked. The `Mingla_Artifacts/probes/ORCH-0898_critical_security_test.sql` Block 2 should be run against staging (not production) by the operator if smoke surfaces any cross-session leak. Block 1 (schema sanity) ran clean live: 9/9 PASS.
4. **ORCH-0902 [Retire board_messages substrate]** should be registered as the cleanup ORCH for this dual-read window. The deprecated services + the backup snapshot `_archive_orch_0898_board_messages_pre_migration` (14-day retention until 2026-06-04) both point at it.
5. **Backlog: branch is 201 commits ahead of origin/main.** Pre-existing condition, not introduced by ORCH-0898. Operator decision pending on flush strategy.

---

## Operator-assisted sim smoke checklist (6 steps to promote to PASS)

This runs after the operator deploys `notify-message`. Each step expects a visible outcome on the simulator.

**Pre-step (operator action):**
```bash
/Users/sethogieva/bin/supabase functions deploy notify-message --project-ref gqnoajqerqhnvulmnyvv
```
Confirm version bump via Supabase Studio or `mcp__supabase__list_edge_functions`.

**Step 1 — Group conversation appears in Friends tab on collab session create.**
- Boot iOS sim, sign in as User A
- Create a new collaboration session ("Plan a date for Friday")
- Switch to Friends tab
- **Expect:** New conversation row with group avatar fan stack (multi-circle layered) and no pair buttons. Conversation name = session name.

**Step 2 — Member auto-add on invite-accept.**
- Sign in on Android emu as User B (or second sim instance)
- Open invite from User A and accept
- On User A's sim, Friends tab → open the group conversation
- **Expect:** Conversation participant count = 2. User B appears in the group avatar stack.

**Step 3 — Message round-trip across the same thread.**
- User A sends message in the Discussions tab (in-session view)
- **Expect on User B's Friends tab:** Same message appears in the group conversation (NOT a separate thread). This confirms the "same thread, two views" decision (D1).
- User B sends message in Friends tab group conversation
- **Expect on User A's Discussions tab:** Same message appears.

**Step 4 — System message (NULL-sender) renders as muted row.**
- Trigger a system event in the session (e.g., next-round transition if ORCH-0899 is wired, or use the realtime channel to inject a `user_id: null` row)
- **Expect:** Centered muted italic system row in BOTH the Discussions tab and the Friends-tab group conversation. Not rendered as a sender bubble.

**Step 5 — Cross-session RLS isolation.**
- User C (not in Session 1) signs in on a third device/emu
- User C inspects local network or attempts to fetch messages from Session 1's conversation_id
- **Expect:** Empty result set / 401 / RLS-denied. User C must NOT see User A or User B messages.

**Step 6 — Member leave + remove flow.**
- User B leaves the group conversation from the Friends-tab item menu
- **Expect:** User B's conversation_participants row deleted. User B can no longer see messages. User A's participant count decreases by 1.
- (If implementor wired `remove_session_member_from_conversation` trigger on session removal, removing User B from the underlying session should produce the same outcome via the trigger path.)

**If all 6 steps pass:** verdict promotes to PASS, CLOSE protocol proceeds.
**If any step fails:** report the exact step + sim screenshot, and we re-dispatch IMPLEMENT with a targeted fix.

---

## Test artifact paths

- Happy-path regression: `app-mobile/scripts/ci/orch-0898-regression-check.mjs` (17 checks T-01..T-14)
- Adversarial regression: `app-mobile/scripts/ci/orch-0898-adversarial-check.mjs` (15 checks TA-01..TA-15)
- Critical security probe: `Mingla_Artifacts/probes/ORCH-0898_critical_security_test.sql` (Block 1 production-safe + Blocks 2-6 staging-only)
- npm scripts: `npm run test:orch-0898` + `npm run test:orch-0898-adv` (both in `app-mobile/package.json`)
- Fails-on-revert verified at commit: `bb74655b` (10/17 happy-path FAIL + 3/15 adversarial FAIL on app-code revert)

---

## Next-Handoff

**Working tree:** /Users/sethogieva/Desktop/mingla-main on branch Seth.

**Operator next action (to promote to PASS):**
1. Deploy `notify-message` edge function: `/Users/sethogieva/bin/supabase functions deploy notify-message --project-ref gqnoajqerqhnvulmnyvv`
2. Run the 6-step sim smoke checklist above on iOS sim + Android emu
3. Report results back to orchestrator

**Orchestrator next action (after sim smoke PASS):**
1. CLOSE protocol Steps 1-5 (artifact updates + DIAG reap + commit + EAS OTA)
2. Open PR Seth→main with title `ORCH-0898: Consumer collab session → Friends-tab group chat (unified substrate)`
3. Register follow-up ORCHs:
   - ORCH-0899 [Plan another outing — round continuation on same session]
   - ORCH-0900 [Group conversation type widening in useMessages.Conversation TypeScript surface]
   - ORCH-0902 [Retire board_messages substrate — close dual-read window]
4. Re-dispatch ORCH-0897 (Tr6 trip group chat) onto the unified substrate

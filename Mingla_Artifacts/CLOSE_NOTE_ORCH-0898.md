# CLOSE NOTE — ORCH-0898 Consumer Collab Session → Friends-Tab Group Chat

> **Status:** CLOSED PASS Grade A — operator-confirmed 6/6 sim smoke 2026-05-21; verdict promoted from CONDITIONAL PASS to PASS.
> **Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
> **Bundle PR:** ships with ORCH-0892-A, ORCH-0892-B v2, ORCH-0893, ORCH-0894, ORCH-0901, ORCH-0898 (operator-named bundle per Working-Branch Discipline rule #5 narrow exception)

---

## Plain-English impact for users

Every collaboration session a user creates now automatically gets a group chat in their Friends tab. Anyone who joins the session auto-joins the chat. Messages sent inside the session's Discussions tab and messages sent inside the Friends-tab group conversation are the **same thread, two views** — not mirrored copies. System events (round transitions, member-join announcements) render as muted italic centered rows. ORCH-0897 [Tr6 trip group chat] will inherit this same substrate without a new migration when that work resumes.

---

## Shipped

### Database (migration `20260624000000_orch_0898_unified_chat_substrate.sql`)

- 6 new columns on `conversations`: `session_id`, `event_id`, `linked_entity_type`, `is_broadcast_only`, `is_enabled`, `name`
- 1 new column on `messages`: `mentions jsonb NOT NULL DEFAULT '[]'::jsonb`
- 1 new column on `conversation_participants`: `notifications_muted bool NOT NULL DEFAULT false`
- 3 SECURITY DEFINER triggers: `ensure_group_conversation_on_session_create`, `sync_session_member_to_conversation`, `remove_session_member_from_conversation`
- 4 RLS policy changes:
  - `messages_broadcast_only_enforcement` (NEW, `AS RESTRICTIVE`, OR'ed brand_team_member active-membership predicate)
  - `conversation_participants_direct_self_add` (NEW, restricted to `c.type='direct'`)
  - Legacy `Users can add themselves to conversations` (DROPPED — not just renamed)
  - Inline EXISTS predicates on all SELECTs (no SECURITY DEFINER helpers)
- 3-branch CHECK constraint `conversations_linked_entity_coherent` (direct/session/trip) — ORCH-0897 inherits
- Backfill: 9 sessions → 9 conversations, 6 board_messages → 6 messages, 21 brand_team_members → 21 conversation_participants; row-count assertion via `RAISE EXCEPTION`
- Backup snapshot `_archive_orch_0898_board_messages_pre_migration` (14-day retention, drop 2026-06-04)

### Edge function (`supabase/functions/notify-message/index.ts` — deployed v153)

- New canonical types `message` + `message_mention` via `handleUnifiedMessage` + `handleUnifiedMention`
- Legacy types (`direct_message`, `board_message`, `board_mention`, `direct_card_message`) preserved as deprecated aliases with `console.warn`
- OneSignal template parameterized: `<sender>` for direct, `<sender> in <name>` for group
- Deep-link format: `mingla://chat/<conv>?type=<direct|group>&sessionId=<s>?&eventId=<e>?`
- `verify_jwt: true` preserved

### Mobile (`app-mobile/`)

- `services/messagingService.ts` — `getOrCreateGroupConversationForSession`, `leaveGroupConversation`, private `translateInsertRlsError` disambiguating broadcast-only vs DM-block 42501 errors
- `services/boardDiscussionService.ts` — `@deprecated`; all 4 write methods throw `[TRANSITIONAL] ORCH-0898 dual-read window: <method> BLOCKED. Exit condition: ORCH-0902`
- `services/boardMessageService.ts` — `@deprecated` header citing ORCH-0902 retirement
- `hooks/useSessionDiscussion.ts` — rewritten onto `conversations` + `messages`; realtime channel `conversation:${conversationId}`
- `components/connections/ChatListItem.tsx` — `ChatListItemConversation` intersection type; group avatar fan stack (3 layered circles); pair buttons hidden for groups
- `components/ConnectionsPage.tsx` — transform passes `type`, `name`, `session_id`
- `components/discussion/MessageBubble.tsx` — NULL-`user_id` early-return → centered muted italic system row
- `components/chat/MessageBubble.tsx` — `isSystem` early-return → centered muted italic system row

### Tests / CI

- `app-mobile/scripts/ci/orch-0898-regression-check.mjs` — 17 structural checks T-01..T-14 (implementor happy-path)
- `app-mobile/scripts/ci/orch-0898-adversarial-check.mjs` — 15 adversarial checks TA-01..TA-15 (tester, attacks different angles)
- Both ran clean; fails-on-revert verified at commit `bb74655b` (10/17 happy-path FAIL on revert; 3/15 adversarial FAIL on revert — TA-10 system row, TA-11 legacy type aliases, TA-14 translateInsertRlsError)
- ORCH-0901 regression re-run independently: 13/13 PASS (cross-ORCH integrity preserved)

---

## Deploy checklist

1. ✅ Migration applied: `supabase db push --linked` (operator-confirmed 2026-05-21)
2. ✅ Edge function deployed: `notify-message` v153 via local CLI (orchestrator owned)
3. ✅ Verified version bump + `verify_jwt: true` preserved
4. ⏳ Bundle PR Seth→main (pre-merge gate)
5. ⏳ EAS OTA: `cd app-mobile && eas update --branch production --platform ios,android --message "ORCH-0898: Consumer collab session → Friends-tab group chat (unified substrate)"`

---

## Operator sim smoke (6/6 PASS — 2026-05-21)

1. ✅ iOS sim — Create collab session as User A → Friends-tab shows new group conversation with multi-avatar fan stack
2. ✅ Android emu — User B accepts invite → participant count = 2, B in avatar stack
3. ✅ Cross-view round-trip — Discussions-tab message visible in Friends-tab group + reverse direction
4. ✅ NULL-sender system row — centered muted italic row in both views
5. ✅ Cross-session RLS — User C in different session cannot read Session 1 messages
6. ✅ Leave group — User B removed; participant count drops; B can no longer see messages

---

## Constitution audit

14/14 PASS or N/A. Notable verifications:
- #2 (one owner per truth): `conversations` is single chat substrate; `board_messages` writes BLOCKED
- #3 (no silent failures): `translateInsertRlsError` + thrown `[TRANSITIONAL]` errors
- #7 (label temporary): all 4 deprecated board service methods cite `Exit condition: ORCH-0902`
- #8 (subtract before adding): legacy `Users can add themselves` policy DROPped; deprecated services throw rather than dual-write
- #9 (no fabricated data): NULL-sender rows render as system messages, not synthesized sender bubbles

---

## Step 0.5 regression-test gate

**SATISFIED.**

- Implementor happy-path: `app-mobile/scripts/ci/orch-0898-regression-check.mjs` — 17/17 PASS; fails-on-revert verified at `bb74655b` (10/17 FAIL on revert)
- Tester adversarial: `app-mobile/scripts/ci/orch-0898-adversarial-check.mjs` — 15/15 PASS attacking different angles; fails-on-revert verified at `bb74655b` (3/15 FAIL on revert — TA-10 / TA-11 / TA-14)
- Both files in closing diff (no merge-magic absorption)

---

## DIAG-marker reap

Zero matches for `[ORCH-0898-DIAG]` across `mingla-business/src/`, `mingla-business/app/`, `app-mobile/src/`, `supabase/functions/`, `mingla-admin/src/`. Step 1.5 PASS.

---

## Follow-ups carried forward

- **ORCH-0902 [Retire board_messages substrate — close dual-read window]** — drop deprecated services, drop `_archive_orch_0898_board_messages_pre_migration` backup table after retention window (2026-06-04)
- **ORCH-0897 [Tr6 trip group chat]** — resume on unified substrate; needs (a) trigger fire on trip creation, (b) RLS active-membership predicate extension to trip-creator, (c) Friends-tab item label. **No schema migration required.**
- **ORCH-0899 [Plan another outing — round continuation on same session]** — round-spanning chat keyed by `session_id` (not `round_id`); NULL-sender system messages render as muted rows + count as unread via ORCH-0901's `.or('sender_id.neq...,sender_id.is.null')` predicate
- **ORCH-0900 [Group conversation type widening in useMessages.Conversation TypeScript surface]** — proper union type instead of intersection workaround in `ChatListItem.tsx`
- **DISCOVERY: Forensics spec backport** — `SPEC_ORCH-0898_COLLAB_GROUP_CHAT.md` §3.1 Step 6c is missing `AS RESTRICTIVE` keyword. Implementor caught + used RESTRICTIVE correctly. Spec text should be backported so future readers don't pattern-match a PERMISSIVE policy.
- **DISCOVERY: Pre-existing Friend type collision** at `app-mobile/src/components/ConnectionsPage.tsx:2773` (baseline tsc warning, shifted from line 2765 due to Phase 5b 3-line edit). Not introduced by this ORCH. Register as a low-priority cleanup ORCH if useful.

---

## Artifacts

- Investigation: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0898_COLLAB_GROUP_CHAT.md`
- Spec: `Mingla_Artifacts/specs/SPEC_ORCH-0898_COLLAB_GROUP_CHAT.md`
- Implementation: `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0898_COLLAB_GROUP_CHAT_v2.md`
- QA: `Mingla_Artifacts/reports/QA_ORCH-0898_COLLAB_GROUP_CHAT_REPORT.md`
- Probes: `Mingla_Artifacts/probes/ORCH-0898_critical_security_test.sql`

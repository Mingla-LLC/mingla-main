# SPEC — ORCH-0898 [Consumer collab session → Friends-tab group chat (shared thread, auto-roster, harmonized with ORCH-0897 trip group chat)]

**Skill:** Claude `mingla-forensics` — SPEC mode (follow-on to INVESTIGATE complete + orchestrator REVIEW APPROVED 2026-05-20).
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0898_COLLAB_GROUP_CHAT.md`
**Dispatch:** `Mingla_Artifacts/prompts/SPEC_ORCH-0898_COLLAB_GROUP_CHAT.md`
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Date:** 2026-05-21

---

## §1 Investigation ingest + locked decisions

### §1.1 Investigation summary (binding context)

Per `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0898_COLLAB_GROUP_CHAT.md` (orchestrator REVIEW APPROVED 2026-05-20, HIGH confidence):

- Three messaging substrates exist or are proposed in the codebase — `board_*` (Family A — shipped consumer collab Discussions), `conversations`+`messages` (Family B — shipped consumer Friends DMs, with `type` already enumerating `'group'` at baseline migration line 8013), and `event_threads` (Family C — proposed in Tr6 milestone, NOT BUILT).
- Substrate decision (operator-approved 2026-05-20): **option (iii) hybrid** — `conversations`+`messages` (Family B) is the unified substrate; `board_messages` retained as backing data for one release then dropped in ORCH-0902 [board* services consolidation].
- Six structural facts back the decision (investigation §3.1) — `conversations.type='group'` already in schema; Family B RLS uses inline EXISTS (RLS-RETURNING-OWNER-GAP safe); `messages` has richer feature surface; `notify-message` already substrate-unified; Friends-tab list integration automatic; ORCH-0897 [Tr6 trip group chat] convergence non-disruptive because Tr6 is locked-but-not-started.

### §1.2 ORCH-0901 dependency satisfied

`messagingService.getConversations` perf refactor + NULL-sender unread fix shipped at commit `bb74655b` 2026-05-20. Means:

- The list-cold-load is already <2s on N=20 conversations and proven correct via operator iOS sim smoke 7/7 PASS.
- The NULL-sender fix (`.or('sender_id.neq.${userId},sender_id.is.null')`) is live — round-start system messages from ORCH-0899 [Plan another outing] will correctly count as unread the day they're posted.
- The novel Postgrest patterns (`.is('embedded.col', null)`, `.limit(N, { referencedTable: '<alias>' })`) are now `proven` at runtime — reusable in this SPEC's UI layer.
- The query has no filter on `conversations.type` — group rows will appear in the Friends-tab list automatically with zero more code changes.

### §1.3 Operator-locked decisions (binding — NOT open for re-litigation)

| # | Decision | Source |
|---|---|---|
| D1 | Chat model: same thread, two views (Discussions tab + Friends-tab thread are ONE conversation surfaced twice). NOT mirrored copies. | Operator 2026-05-20 AskUserQuestion |
| D2 | Substrate: option (iii) hybrid — unified `conversations`+`messages`. | Operator 2026-05-20 |
| D3 | ORCH-0897 convergence: Tr6 inherits this substrate (NOT its own `event_threads` tables). Tr6 SPEC is BLOCKED on this SPEC. | Operator 2026-05-20 |
| D4 | ORCH-0899 cross-link: chat keyed by `session_id` (NOT round_id). Chat persists across all future re-openable rounds. Round transitions post `sender_id IS NULL` system messages. | Operator 2026-05-20 + ORCH-0899 INTAKE |
| D5 | No fourth chat substrate. | Operator 2026-05-20 |

### §1.4 Schema corrections discovered in Phase 0 (binding for this SPEC)

The investigation report + dispatch prompt + Tr6 milestone all reference a table called `brand_members`. **The actual table is `brand_team_members`** (baseline migration line 7740). Active-membership predicate is `accepted_at IS NOT NULL AND removed_at IS NULL`. This SPEC uses the correct name and active-membership predicate throughout. **Discovery #1 carried forward to orchestrator for backporting into the investigation report.**

---

## §2 Scope, non-goals, assumptions

### §2.1 Scope (exhaustive)

The SPEC ships these contracts:

1. **Database layer:** new migration `20260624000000_orch_0898_unified_chat_substrate.sql` adds 6 new columns on `conversations` + 1 new column on `messages` + 1 new column on `conversation_participants` + 2 trigger functions + 2 triggers + 3 new RLS policies (or policy extensions) + 1 RLS tightening + data backfill from `board_messages` to `messages` + backup snapshot table.
2. **Edge function layer:** `notify-message` simplified — type discriminator collapsed; recipient list via single `conversation_participants` query; OneSignal template parameterized by `conversations.type`.
3. **Service layer (`app-mobile/src/services/`):** `messagingService.ts` gains `getOrCreateGroupConversationForSession(sessionId)`; `getConversation` + `sendMessage` verified to handle group + broadcast-only branches. `boardMessageService.ts` + `boardDiscussionService.ts` retained as read-only adapters during 1-release dual-read transition (deprecation comment added).
4. **Hook layer (`app-mobile/src/hooks/`):** `useSessionDiscussion.ts` rewritten to read from `messages` via `messagingService`; query key migrated; realtime channel renamed from `discussion:${sessionId}` to `conversation:${conversationId}`.
5. **Component layer (`app-mobile/src/components/`):** `connections/ChatListItem.tsx` branches on `conversation.type` for render (single-avatar direct vs multi-avatar group); new `system-message` render path on `MessageBubble.tsx` for `sender_id IS NULL` messages; optional new component `connections/MultiAvatarStack.tsx`. `SessionViewModal.tsx` `BoardDiscussionTab` rebinds to the refactored hook.
6. **Test layer:** implementor happy-path regression script at `app-mobile/scripts/ci/orch-0898-regression-check.mjs` (T-01..T-10); tester adversarial regression script at `app-mobile/scripts/ci/orch-0898-adversarial-check.mjs` (TA-01..TA-10); both added to `app-mobile/package.json` as `test:orch-0898` + `test:orch-0898-adv` npm scripts.
7. **Migration follow-on:** `board_messages` retained as backing data (1 release); ORCH-0902 [board* services consolidation] retires Family A after dual-read window passes; backup snapshot `_archive_orch_0898_board_messages_pre_migration` retained 14 days then dropped via scheduled cleanup ORCH.

### §2.2 Non-goals (explicit exclusions)

- **NO drop of `board_messages` table** in this ORCH. Retained 1 release; ORCH-0902 retires.
- **NO `board_card_messages` migration** (per-card chat on Discover deck cards). Investigation §3.4. Out of scope; future ORCH if needed.
- **NO change to `notify-dispatch` edge function** — only `notify-message` upstream simplifies.
- **NO consumer-app UI for `is_broadcast_only`** — column exists for Tr6 future use but no consumer surface reads or writes it. Consumer collab conversations always have `is_broadcast_only=false`.
- **NO Tr6 UI components** (DiscussionTab/DocumentsTab/TripDiscussionView). Tr6 ships in a separate ORCH-0897 SPEC after this lands; this SPEC builds the substrate Tr6 inherits.
- **NO `trip_documents` storage bucket** — orthogonal to chat substrate; lives in ORCH-0897.
- **NO ORCH-0899 UI for "Plan another outing"** — but the substrate must support round-spanning chat + system messages. ORCH-0899's UI ships separately.
- **NO ORCH-0900 [useMessages.ts dead-code cleanup]** — independent track. The dual-`Conversation` type collision (server-shape in `messagingService.ts:211` vs UI-shape in `useMessages.ts:34`) is NOT resolved in this ORCH; consumers continue using whichever they import today.
- **NO Tr6 buyer "Join the trip chat" affordance** — order-confirmation UI changes belong to ORCH-0897.
- **NO Ari `agent_tools` summarization tool** — Tr6 milestone §3 criterion #12 deferred to ORCH-0897.
- **NO ChatListItem visual redesign beyond the type branch** — group conversations render with the SAME design tokens as direct (multi-avatar stack is the only visual addition).
- **NO new realtime channel topology** — same dual postgres_changes + broadcast pattern from `boardDiscussionService` ported to the unified substrate.

### §2.3 Assumptions (must hold at implementation start)

| # | Assumption | Verification path |
|---|---|---|
| A1 | Postgrest nested-resource ordering + limit with `referencedTable` parameter is supported in supabase-js v2.74. | Proven at runtime by ORCH-0901 commit `bb74655b` operator sim smoke 2026-05-20. |
| A2 | RLS policy `Users can view conversations they participate in` (baseline migration line 14966) correctly filters via EXISTS subquery on `conversation_participants`. | Confirmed by investigation §4 layer audit + ORCH-0901 §4 cross-check. |
| A3 | `messages.sender_id` is nullable (baseline migration line 8424). | Confirmed by direct schema read this turn. |
| A4 | `conversation_participants` already has `UNIQUE (conversation_id, user_id)` constraint — `ON CONFLICT DO NOTHING` works. | Confirmed by direct schema read this turn: `conversation_participants_conversation_id_user_id_key`. |
| A5 | `session_participants` already has `UNIQUE (session_id, user_id)` constraint. | Confirmed by direct schema read this turn: `session_participants_session_id_user_id_key`. |
| A6 | `brand_team_members` is the correct brand-membership table (NOT `brand_members`). Active-membership predicate is `accepted_at IS NOT NULL AND removed_at IS NULL`. | Confirmed by direct schema read this turn (line 7740). |
| A7 | `conversations.type` already enumerates `'direct' | 'group'` via CHECK constraint `conversations_type_check` (line 8013). | Confirmed. |
| A8 | The latest migration prefix in `supabase/migrations/` is `20260623000000`. New migration must use prefix strictly greater (`20260624000000`). | Confirmed by `ls supabase/migrations/` this turn. Per Working-Branch Discipline rule #5. |
| A9 | `getConversations` post-ORCH-0901 has no filter on `conversations.type` — group rows appear automatically once they exist. | Confirmed by ORCH-0901 SC-07 + tester adversarial TA-06 PASS at commit `bb74655b`. |

---

## §2.5 Cross-Surface Impact (MANDATORY per Phase 2.5)

| # | Surface | In scope? | User-visible behaviour | File paths touched | Parity |
|---|---|---|---|---|---|
| 1 | **Consumer iOS** (`app-mobile/` on iOS) | YES (primary) | Creating a collab session auto-spawns a group chat in Friends-tab list. Tapping it opens the same conversation as the in-session Discussions tab. Auto-join when a user accepts a collab invite. System messages (`sender_id IS NULL`) render as centered muted rows. Existing DM behaviour unchanged. | `app-mobile/src/services/messagingService.ts`, `app-mobile/src/hooks/useSessionDiscussion.ts`, `app-mobile/src/components/SessionViewModal.tsx`, `app-mobile/src/components/ConnectionsPage.tsx`, `app-mobile/src/components/connections/ChatListItem.tsx`, optional new `app-mobile/src/components/connections/MultiAvatarStack.tsx`, `app-mobile/src/components/discussion/MessageBubble.tsx` (system-row render branch), `app-mobile/src/components/chat/MessageBubble.tsx` (system-row render branch — same component family, both rendered group chats may use it) | Automatic (shared RN code) |
| 2 | **Consumer Android** (`app-mobile/` on Android) | YES (parity) | Same as iOS. | Same. | Automatic (shared RN code) |
| 3 | **Buyer-anon Web** | NO | No Friends tab there + no consumer collab. RLS still requires `auth.uid()` — anon users can't read group chats. | — | Reason: no consumer collab surface on buyer-anon-web. |
| 4 | **Business iOS** | SUBSTRATE-ONLY | Tr6's per-trip group chat ships its UI in a SEPARATE ORCH-0897 SPEC after this SPEC lands. The DB columns + RLS policies in this migration support Tr6's inheritance (event_id + linked_entity_type='trip' + is_broadcast_only). | DB migration file only — no `mingla-business/` code change in this ORCH. | Reason: Tr6 UI is ORCH-0897 scope. |
| 5 | **Business Android** | SUBSTRATE-ONLY | Same as Business iOS. | Same. | Reason: Tr6 UI is ORCH-0897 scope. |
| 6 | **Admin Web** (`mingla-admin/`) | NO | No consumer messaging admin surface today. Future moderation tooling would land in a separate ORCH. | — | Reason: no admin equivalent today. |
| 7 | **Business Web preview** | NO | No business-side group-chat UI ships in this ORCH (Tr6 ORCH-0897 owns that). | — | Reason: Tr6 UI is ORCH-0897 scope. |

**Parity verdict:** automatic across iOS + Android (shared RN code in `app-mobile/`). Per the parity-enforcement rule, the tester must verify behaviour on BOTH iOS sim + Android emu. Single success criteria per behaviour — no separate `-iOS` / `-Android` rows required because there are no platform-specific code paths.

---

## §3 Layer-by-layer specifications

### §3.1 Database layer

**Migration file:** `supabase/migrations/20260624000000_orch_0898_unified_chat_substrate.sql`

Sequence within the migration (binding order — implementor must follow):

#### Step 1 — New columns on `conversations`

```sql
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS session_id uuid NULL
    REFERENCES public.collaboration_sessions(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS event_id uuid NULL
    REFERENCES public.events(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS linked_entity_type text NOT NULL DEFAULT 'direct'
    CHECK (linked_entity_type IN ('direct', 'session', 'trip')),
  ADD COLUMN IF NOT EXISTS is_broadcast_only boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS name text NULL;

-- Coherence CHECK: each linked_entity_type pins exactly one of session_id / event_id / neither.
ALTER TABLE public.conversations
  ADD CONSTRAINT conversations_linked_entity_coherent CHECK (
    (linked_entity_type = 'direct' AND session_id IS NULL AND event_id IS NULL) OR
    (linked_entity_type = 'session' AND session_id IS NOT NULL AND event_id IS NULL) OR
    (linked_entity_type = 'trip' AND event_id IS NOT NULL AND session_id IS NULL)
  );

-- Group conversations must have a name; direct conversations may leave NULL (derived from participants).
ALTER TABLE public.conversations
  ADD CONSTRAINT conversations_group_requires_name CHECK (
    (type = 'direct' AND name IS NULL) OR
    (type = 'group' AND name IS NOT NULL AND length(trim(name)) > 0)
  );

-- One conversation per linked entity.
CREATE UNIQUE INDEX IF NOT EXISTS conversations_unique_session_id
  ON public.conversations (session_id)
  WHERE session_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS conversations_unique_event_id
  ON public.conversations (event_id)
  WHERE event_id IS NOT NULL;

-- Lookup acceleration for the Friends-tab list query (post-ORCH-0901 perf):
CREATE INDEX IF NOT EXISTS conversations_linked_entity_lookup
  ON public.conversations (linked_entity_type, session_id, event_id);
```

#### Step 2 — New column on `messages`

```sql
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS mentions jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.messages.mentions IS
  'ORCH-0898: array of user_ids referenced via @ in the message content. Mirrors board_messages.mentions shape (jsonb array of uuids). Backfilled from board_messages.mentions during the ORCH-0898 migration. Per-message mention payload; mention-driven push notifications fan out via notify-message type=message_mention.';
```

#### Step 3 — New column on `conversation_participants`

```sql
ALTER TABLE public.conversation_participants
  ADD COLUMN IF NOT EXISTS notifications_muted boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.conversation_participants.notifications_muted IS
  'ORCH-0898 / ORCH-0520 lineage: per-(conversation, user) mute flag. When true, notify-message suppresses push for this recipient. Does NOT suppress the in-app notification row. Backfilled from session_participants.notifications_muted during the migration.';
```

#### Step 4 — Trigger function: auto-create group conversation on session creation

```sql
CREATE OR REPLACE FUNCTION public.ensure_group_conversation_on_session_create()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conv_id uuid;
  v_session_name text;
BEGIN
  -- Use the session name as default conversation name. Fall back to "Group chat" if empty.
  v_session_name := COALESCE(NULLIF(trim(NEW.name), ''), 'Group chat');

  -- Idempotent insert via UNIQUE (session_id) where session_id IS NOT NULL.
  INSERT INTO public.conversations (
    type,
    linked_entity_type,
    session_id,
    name,
    created_by,
    is_enabled,
    is_broadcast_only
  ) VALUES (
    'group',
    'session',
    NEW.id,
    v_session_name,
    NEW.created_by,
    true,
    false
  )
  ON CONFLICT (session_id) WHERE session_id IS NOT NULL DO NOTHING
  RETURNING id INTO v_conv_id;

  -- Add the session creator as the first participant. Idempotent via UNIQUE constraint.
  IF v_conv_id IS NOT NULL AND NEW.created_by IS NOT NULL THEN
    INSERT INTO public.conversation_participants (conversation_id, user_id)
      VALUES (v_conv_id, NEW.created_by)
      ON CONFLICT (conversation_id, user_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER ensure_group_conversation_on_session_create
  AFTER INSERT ON public.collaboration_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.ensure_group_conversation_on_session_create();
```

#### Step 5 — Trigger function: mirror session_participants → conversation_participants

```sql
CREATE OR REPLACE FUNCTION public.sync_session_member_to_conversation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conv_id uuid;
BEGIN
  -- Only mirror users who have accepted the invite (has_accepted=true).
  -- The WHEN clause on the trigger gates this, but defense-in-depth:
  IF NEW.has_accepted IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  -- Find the group conversation for this session (created by Step 4's trigger).
  SELECT id INTO v_conv_id
  FROM public.conversations
  WHERE session_id = NEW.session_id
    AND linked_entity_type = 'session';

  IF v_conv_id IS NOT NULL THEN
    INSERT INTO public.conversation_participants (conversation_id, user_id)
      VALUES (v_conv_id, NEW.user_id)
      ON CONFLICT (conversation_id, user_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

-- Fires on INSERT (new participant accepting up-front) OR UPDATE OF has_accepted (invite flip).
CREATE TRIGGER mirror_session_participant_to_conversation
  AFTER INSERT OR UPDATE OF has_accepted ON public.session_participants
  FOR EACH ROW
  WHEN (NEW.has_accepted = true)
  EXECUTE FUNCTION public.sync_session_member_to_conversation();
```

**Removal-side trigger (auto-leave on session-leave per Q1 default):**

```sql
CREATE OR REPLACE FUNCTION public.remove_session_member_from_conversation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conv_id uuid;
BEGIN
  SELECT id INTO v_conv_id
  FROM public.conversations
  WHERE session_id = OLD.session_id
    AND linked_entity_type = 'session';

  IF v_conv_id IS NOT NULL THEN
    DELETE FROM public.conversation_participants
    WHERE conversation_id = v_conv_id AND user_id = OLD.user_id;
  END IF;

  RETURN OLD;
END;
$$;

CREATE TRIGGER remove_session_participant_from_conversation
  AFTER DELETE ON public.session_participants
  FOR EACH ROW
  EXECUTE FUNCTION public.remove_session_member_from_conversation();
```

#### Step 6 — RLS policy additions + tightening

**6a. New brand-team-member read policy on `conversations` (for Tr6 inheritance):**

```sql
CREATE POLICY conversations_brand_team_member_read
  ON public.conversations
  FOR SELECT
  USING (
    linked_entity_type = 'trip'
    AND event_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.brand_team_members btm
      JOIN public.events e ON e.brand_id = btm.brand_id
      WHERE e.id = conversations.event_id
        AND btm.user_id = auth.uid()
        AND btm.accepted_at IS NOT NULL
        AND btm.removed_at IS NULL
    )
  );
```

**6b. New brand-team-member read policy on `messages`:**

```sql
CREATE POLICY messages_brand_team_member_read
  ON public.messages
  FOR SELECT
  USING (
    deleted_at IS NULL
    AND EXISTS (
      SELECT 1
      FROM public.conversations c
      WHERE c.id = messages.conversation_id
        AND c.linked_entity_type = 'trip'
        AND c.event_id IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM public.brand_team_members btm
          JOIN public.events e ON e.brand_id = btm.brand_id
          WHERE e.id = c.event_id
            AND btm.user_id = auth.uid()
            AND btm.accepted_at IS NOT NULL
            AND btm.removed_at IS NULL
        )
    )
  );
```

**6c. New broadcast-only INSERT policy on `messages` (extends existing INSERT policy):**

The existing policy `Users can send messages to conversations they participate in` at baseline migration line 14842 stays in force for `'direct'` + `'session'` + non-broadcast `'trip'` cases. Add a NEW conditional policy that BLOCKS buyer-side writes when broadcast_only is on:

```sql
CREATE POLICY messages_broadcast_only_enforcement
  ON public.messages
  FOR INSERT
  WITH CHECK (
    -- Either the message is to a non-trip conversation OR a non-broadcast trip OR the sender is a brand_team_member.
    NOT EXISTS (
      SELECT 1
      FROM public.conversations c
      WHERE c.id = messages.conversation_id
        AND c.linked_entity_type = 'trip'
        AND c.is_broadcast_only = true
    )
    OR EXISTS (
      SELECT 1
      FROM public.conversations c
      JOIN public.events e ON e.id = c.event_id
      JOIN public.brand_team_members btm ON btm.brand_id = e.brand_id
      WHERE c.id = messages.conversation_id
        AND c.linked_entity_type = 'trip'
        AND c.is_broadcast_only = true
        AND btm.user_id = auth.uid()
        AND btm.accepted_at IS NOT NULL
        AND btm.removed_at IS NULL
    )
  );
```

(Note: in PostgreSQL, multiple PERMISSIVE policies on the same operation are OR'd; the existing `Users can send messages to conversations they participate in` policy AND `messages_broadcast_only_enforcement` AND `messages_brand_team_member_insert` (if needed for non-participating brand members on Tr6) must ALL pass. The implementor must verify the policy combination produces the intended behaviour via TA-02 in §6.)

**6d. Tightening self-add policy on `conversation_participants`:**

The existing `Users can add themselves to conversations` policy (baseline migration line 14541) permits self-add. For `type='direct'` this is the lazy-creation DM path — must stay. For `type='group'` self-add must be FORBIDDEN — roster sync is trigger-only.

```sql
-- DROP the existing too-permissive self-add policy.
DROP POLICY IF EXISTS "Users can add themselves to conversations" ON public.conversation_participants;

-- REPLACE with a tighter version that only allows self-add for direct conversations.
CREATE POLICY conversation_participants_direct_self_add
  ON public.conversation_participants
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.conversations c
      WHERE c.id = conversation_participants.conversation_id
        AND c.type = 'direct'
    )
  );

-- Service-role / trigger inserts bypass RLS (SECURITY DEFINER) — group adds go through triggers.
```

(The implementor must verify the existing DM code paths in `messagingService.getOrCreateDirectConversation` + `createNewConversation` still work; the tighter policy only blocks self-add to GROUP conversations.)

#### Step 7 — Data backfill: board_messages → messages + conversations rows

```sql
-- Step 7a: Backup snapshot for rollback (14-day retention, dropped via scheduled cleanup).
CREATE TABLE IF NOT EXISTS public._archive_orch_0898_board_messages_pre_migration AS
  SELECT * FROM public.board_messages;

COMMENT ON TABLE public._archive_orch_0898_board_messages_pre_migration IS
  'ORCH-0898 backup snapshot of board_messages pre-migration. Retain 14 days; drop in scheduled cleanup ORCH after 2026-07-08. Used as rollback source if the unified-substrate migration surfaces a corruption.';

-- Step 7b: Backfill conversations from collaboration_sessions that have ≥1 board_messages row.
INSERT INTO public.conversations (
  id, type, linked_entity_type, session_id, name, created_by, is_enabled, is_broadcast_only, created_at, updated_at
)
SELECT
  gen_random_uuid(),
  'group',
  'session',
  cs.id,
  COALESCE(NULLIF(trim(cs.name), ''), 'Group chat'),
  cs.created_by,
  true,
  false,
  cs.created_at,
  cs.updated_at
FROM public.collaboration_sessions cs
WHERE EXISTS (
  SELECT 1 FROM public.board_messages bm
  WHERE bm.session_id = cs.id AND bm.deleted_at IS NULL
)
AND NOT EXISTS (
  SELECT 1 FROM public.conversations c
  WHERE c.session_id = cs.id AND c.linked_entity_type = 'session'
);

-- Step 7c: Backfill conversation_participants from session_participants (accepted only).
INSERT INTO public.conversation_participants (conversation_id, user_id, notifications_muted, joined_at)
SELECT
  c.id,
  sp.user_id,
  COALESCE(sp.notifications_muted, false),
  sp.joined_at
FROM public.session_participants sp
JOIN public.conversations c ON c.session_id = sp.session_id AND c.linked_entity_type = 'session'
WHERE sp.has_accepted = true
ON CONFLICT (conversation_id, user_id) DO NOTHING;

-- Step 7d: Backfill messages from board_messages. Two-pass because reply_to_id needs ID translation.
-- Pass 1: create a temporary mapping table from board_messages.id → new messages.id.
CREATE TEMP TABLE _orch_0898_msg_id_map (
  board_message_id uuid PRIMARY KEY,
  new_message_id uuid NOT NULL
);

WITH inserted AS (
  INSERT INTO public.messages (
    id, conversation_id, sender_id, content, message_type,
    file_url, file_name, file_size, card_payload, reply_to_id,
    mentions, created_at, updated_at, deleted_at, is_read, read_at
  )
  SELECT
    gen_random_uuid(),
    c.id,
    bm.user_id,
    bm.content,
    CASE WHEN bm.image_url IS NOT NULL THEN 'image' ELSE 'text' END,
    bm.image_url,
    NULL, -- board_messages has no file_name
    NULL, -- or file_size
    NULL, -- or card_payload
    NULL, -- reply_to_id mapped in pass 2
    COALESCE(bm.mentions, '[]'::jsonb),
    bm.created_at,
    bm.updated_at,
    bm.deleted_at,
    false, -- is_read flag is per-recipient via message_reads, not on messages
    NULL,
    bm.id AS source_board_message_id -- carries source id for the map
  FROM public.board_messages bm
  JOIN public.conversations c ON c.session_id = bm.session_id AND c.linked_entity_type = 'session'
  RETURNING id, source_board_message_id
)
INSERT INTO _orch_0898_msg_id_map (board_message_id, new_message_id)
SELECT source_board_message_id, id FROM inserted;

-- Pass 2: backfill reply_to_id using the ID map.
UPDATE public.messages m
SET reply_to_id = map_dst.new_message_id
FROM _orch_0898_msg_id_map map_src
JOIN _orch_0898_msg_id_map map_dst ON true
JOIN public.board_messages bm ON bm.id = map_src.board_message_id
WHERE m.id = map_src.new_message_id
  AND bm.reply_to_id = map_dst.board_message_id;

-- Step 7e: Backfill message_reads from board_message_reads via the ID map.
INSERT INTO public.message_reads (message_id, user_id, read_at)
SELECT
  map.new_message_id,
  bmr.user_id,
  bmr.read_at
FROM public.board_message_reads bmr
JOIN _orch_0898_msg_id_map map ON map.board_message_id = bmr.message_id
ON CONFLICT (message_id, user_id) DO NOTHING;

-- Step 7f: Row-count assertions (raise EXCEPTION on mismatch).
DO $$
DECLARE
  v_src_messages bigint;
  v_dst_messages bigint;
  v_diff bigint;
BEGIN
  SELECT COUNT(*) INTO v_src_messages
  FROM public.board_messages bm
  JOIN public.collaboration_sessions cs ON cs.id = bm.session_id;

  SELECT COUNT(*) INTO v_dst_messages
  FROM public.messages m
  JOIN public.conversations c ON c.id = m.conversation_id
  WHERE c.linked_entity_type = 'session';

  v_diff := v_src_messages - v_dst_messages;

  IF v_diff > 0 THEN
    RAISE EXCEPTION 'ORCH-0898 backfill row-count mismatch: board_messages=%, messages-session-linked=%, missing=%', v_src_messages, v_dst_messages, v_diff;
  END IF;

  RAISE NOTICE 'ORCH-0898 backfill OK: board_messages=%, messages-session-linked=%', v_src_messages, v_dst_messages;
END;
$$;

DROP TABLE _orch_0898_msg_id_map;
```

(Operator note: this is a SINGLE migration that runs atomically — backfill happens in the same transaction as the schema changes. If anything fails, the whole migration rolls back and the database is untouched.)

#### Step 8 — Migration filename

`supabase/migrations/20260624000000_orch_0898_unified_chat_substrate.sql`

Per Working-Branch Discipline rule #5 — strictly greater than the current max prefix `20260623000000` (verified this turn).

**NO operator `supabase db push --linked` happens until orchestrator REVIEW APPROVES this SPEC + implementor finishes writing the migration file.** This SPEC defines the contract; implementor writes the actual SQL; operator applies.

### §3.2 Edge function layer

**File:** `supabase/functions/notify-message/index.ts`

**Before:** 5 type discriminators (`direct_message | board_message | board_mention | direct_card_message | board_card_message`). Recipient list query at line 154 branches on type — `session_participants` for board types, `conversation_participants` for direct types.

**After (post-ORCH-0898):**

```typescript
// Type discriminator collapses to:
type: "message" | "message_mention" | "board_card_message";
// "board_card_message" retained for the per-card-chat feature (board_card_messages table —
// NOT migrated by ORCH-0898 per §2.2 non-goals).
// "message" handles both direct + group conversations via conversation_participants fan-out.
// "message_mention" handles mention notifications (was "board_mention").

// Recipient list query (single path):
const { data: recipients } = await supabase
  .from("conversation_participants")
  .select("user_id, notifications_muted")
  .eq("conversation_id", conversationId)
  .neq("user_id", senderId)
  .eq("notifications_muted", false); // respect per-user mute
```

**OneSignal template parameterization:**

- Direct conversation: title `<sender_name>`, body `<message_preview>`.
- Group conversation: title `<sender_name> in <conversations.name>`, body `<message_preview>`.

**Deep-link payload:**

- Direct: `mingla://chat/<conversation_id>?type=direct`
- Group (session-linked): `mingla://chat/<conversation_id>?type=group&sessionId=<session_id>`
- Group (trip-linked, Tr6 future): `mingla://chat/<conversation_id>?type=group&eventId=<event_id>`

**Backward-compat period:** for 1 release, the edge function ALSO accepts the legacy types (`direct_message`, `board_message`, `board_mention`, `direct_card_message`) and maps them internally to the new `message`/`message_mention` types. After ORCH-0902 [board* services consolidation] CLOSE, the legacy type names are dropped.

**Operator deploys post-orchestrator-REVIEW + post-implementor:**

```bash
/Users/sethogieva/bin/supabase functions deploy notify-message --project-ref gqnoajqerqhnvulmnyvv
```

Verify version bump via `mcp__supabase__list_edge_functions` per Orchestrator deploy split protocol.

### §3.3 Service layer

**File:** `app-mobile/src/services/messagingService.ts`

**New method:**

```typescript
async getOrCreateGroupConversationForSession(
  sessionId: string
): Promise<{ conversation: Conversation | null; error: string | null }> {
  try {
    // Idempotent — relies on conversations_unique_session_id partial index + the
    // ensure_group_conversation_on_session_create trigger that fires at session-INSERT time.
    // If the trigger didn't fire (legacy session pre-ORCH-0898 backfill), this lookup still works
    // because the migration backfilled conversations rows.
    const { data: conv, error } = await supabase
      .from('conversations')
      .select(`
        *,
        participants:conversation_participants(id, conversation_id, user_id, joined_at, last_read_at)
      `)
      .eq('session_id', sessionId)
      .eq('linked_entity_type', 'session')
      .maybeSingle();

    if (error) throw error;
    if (!conv) {
      return { conversation: null, error: 'Group conversation not found for this session' };
    }

    return {
      conversation: {
        id: conv.id,
        type: conv.type,
        created_by: conv.created_by,
        created_at: conv.created_at,
        updated_at: conv.updated_at,
        last_message_at: conv.last_message_at,
        participants: conv.participants || [],
      },
      error: null,
    };
  } catch (error: any) {
    console.error('Error getting group conversation for session:', error);
    return { conversation: null, error: error.message };
  }
}
```

**Existing methods that need verification (NOT change):**

- `getConversation(conversationId, userId)` (line 455) — verify works for `type='group'` rows. The existing SELECT shape (lines 458-510) covers conversations + participants + messages + message_reads. No change required if Postgrest handles group conversations identically to direct (they should — only `type` value differs).
- `sendMessage(conversationId, senderId, content, replyToId?)` (line 655) — verify the INSERT into `messages` works for group conversations. RLS gates the write; broadcast-only enforcement is at RLS layer (policy §3.1 Step 6c). On RLS rejection, the caller gets a PostgrestError — service must surface a user-friendly toast (Constitution #3).
- `getMessages(conversationId, userId, limit)` (line 600) — verify the messages-list-load works for group. Out of scope for this SPEC; note that this method still has an N+1 enrichMessage pattern (investigation §8 Discovery #2) — register for follow-up.

**Service-layer error contract for broadcast-only RLS rejection:**

When sendMessage hits a broadcast-only conversation as a non-brand-team-member, Postgrest returns 42501. The catch block must translate this to a user-facing error: `'Only the planner can post in this trip's chat'` (per Tr6 milestone §2 step 8 wording). Consumer-app sees this error code and surfaces a toast via the existing Toast component pattern (`feedback_toast_needs_absolute_wrap.md`).

**Deprecation comments on `boardMessageService.ts` + `boardDiscussionService.ts`:**

Add a JSDoc block at the top of each file:

```typescript
/**
 * @deprecated ORCH-0898 [Consumer collab session → Friends-tab group chat] CLOSED 2026-MM-DD.
 * This service is retained as a read-only adapter during the 1-release dual-read transition
 * window. After ORCH-0902 [board* services consolidation] CLOSES, this file will be deleted.
 *
 * DO NOT add new methods here. New chat work goes through `messagingService.ts`.
 *
 * Write methods (sendMessage, toggleReaction, markMessagesAsRead, uploadMessageImage) are
 * BLOCKED — they would write to board_messages which is no longer the canonical store.
 * New writes go through messagingService.sendMessage targeting the unified messages table.
 */
```

The read-path methods (`fetchSessionMessages`) keep working during the dual-read window by reading from `messages` filtered to the session's conversation_id. The implementor must update the internal query.

### §3.4 Hook layer

**File:** `app-mobile/src/hooks/useSessionDiscussion.ts`

**Before:** reads from `board_messages` via `boardDiscussionService.fetchSessionMessages`. Query key `discussionKeys.messages(sessionId)`. Realtime channel `discussion:${sessionId}`.

**After (post-ORCH-0898):**

- First call `messagingService.getOrCreateGroupConversationForSession(sessionId)` to resolve `conversation_id`.
- Then read messages via `messagingService.getMessages(conversation_id, userId, limit)` (or a new infinite-scroll variant).
- Query key migrates from `discussionKeys.messages(sessionId)` to a new key under the existing `chatKeys` factory: `chatKeys.conversation(conversation_id).messages()` (verify a chat-keys factory exists; if not, the implementor establishes one per Constitution #4).
- Realtime channel renames from `discussion:${sessionId}` to `conversation:${conversation_id}`. postgres_changes filter changes from `table=board_messages, session_id=eq.${sessionId}` to `table=messages, conversation_id=eq.${conversation_id}`. Broadcast event name changes from `board_message` to `message`. Dual postgres_changes + broadcast pattern preserved per investigation §6.1.

**Hook return type unchanged externally:** `messages`, `isLoading`, `isError`, `hasNextPage`, `fetchNextPage`, `sendMessage`, `isSending`, `toggleReaction`, `typingUsers`, `startTyping`, `stopTyping`, `refetch`. Internal data shape may differ slightly (DirectMessage vs BoardMessage), but consumer components (`SessionViewModal.tsx`'s `BoardDiscussionTab`) receive identical-shape data through the hook's adapter layer.

**Cache invalidation:**

- On new message via realtime: invalidate `chatKeys.conversation(conversation_id).messages()` AND `chatKeys.conversations(userId).list()` (the Friends-tab list, so the conversation bubbles to the top).
- On send-message mutation success: same invalidation.
- On reaction toggle: invalidate messages list.

**`enabled` condition:** `!!sessionId && !!currentUserId`.
**`staleTime`:** 2 * 60 * 1000 (same as legacy hook).

**Solo/DM parity guard:** the hook must work IDENTICALLY for a direct conversation if accidentally called with a non-session conversation_id. The implementor's regression test T-07 verifies this — `useSessionDiscussion` called with a DM's conversation_id returns the DM's messages without crash.

### §3.5 Component layer

#### 3.5.1 `app-mobile/src/components/connections/ChatListItem.tsx`

**Type branch on render:**

```typescript
// Existing render (direct):
if (conversation.type === 'direct') {
  // existing single-avatar render — UNCHANGED.
  const otherParticipant = conversation.participants.find(p => p.id !== currentUserId);
  return <ExistingDirectRender ... />;
}

// New render (group):
if (conversation.type === 'group') {
  return <GroupChatListItemRender ... />;
}
```

**`GroupChatListItemRender`** spec:

- Avatar slot: `<MultiAvatarStack participants={conversation.participants.slice(0, 3)} currentUserId={currentUserId} />` (or inline 3-avatar render — implementor choice).
- Title slot: `conversation.name` (fallback `'Group chat'` if NULL — defensive; the CHECK constraint prevents this in practice).
- Subtitle slot: `<senderName>: <preview>` for both types — same as direct.
- Unread badge: `conversation.unread_count` — same as direct.
- Star (pair) button: HIDDEN for group (`conversation.type !== 'direct'`).
- Action menu (Swipeable left edge): Archive + Mute + Leave for group (vs Archive + Block for direct). Leave action calls a new `messagingService.leaveGroupConversation(conversation_id, userId)` method which DELETES the user's `conversation_participants` row (RLS-gated to own row only).

#### 3.5.2 `app-mobile/src/components/connections/MultiAvatarStack.tsx` (optional NEW component)

If implementor chooses to extract:

```typescript
interface MultiAvatarStackProps {
  participants: Array<{ id: string; avatar_url?: string; display_name?: string }>;
  currentUserId: string;
  maxAvatars?: number; // default 3
}
```

Renders up to N avatars in a layered fan pattern, with `+M` overlay if `participants.length > maxAvatars`.

#### 3.5.3 `app-mobile/src/components/discussion/MessageBubble.tsx` + `app-mobile/src/components/chat/MessageBubble.tsx`

**System message render branch:**

```typescript
if (message.sender_id === null) {
  return (
    <View style={styles.systemMessageRow}>
      <Text style={styles.systemMessageText} accessibilityLabel="System message">
        {message.content}
      </Text>
    </View>
  );
}
// existing render path unchanged.
```

`systemMessageRow` style: centered horizontally, muted text color (use existing design-token `colors.textMuted`), small font size (one step below body).

System messages bypass: reactions, replies, mentions, swipe-actions, double-tap-heart, context-menu.

**ORCH-0901 NULL-sender fix already supports this:** the `messagingService.getConversations` query at commit `bb74655b` correctly counts NULL-sender messages as unread via the `.or()` predicate. Investigation §13 #10 + SC-09 verified.

#### 3.5.4 `app-mobile/src/components/SessionViewModal.tsx`

Existing `BoardDiscussionTab` mount at line 795 — verify it now receives data from the refactored `useSessionDiscussion` hook (which internally pulls from `messagingService.getMessages` instead of `boardDiscussionService.fetchSessionMessages`). NO render-layer change to BoardDiscussionTab itself — the hook's output shape is preserved via the hook's adapter layer (§3.4).

#### 3.5.5 `app-mobile/src/components/ConnectionsPage.tsx`

**No render change.** The Friends-tab list already reads from `messagingService.getConversations` (post-ORCH-0901). Group conversations appear automatically once they exist in the DB. `ChatListItem` (3.5.1) handles the type-branch render.

**One minor update:** the empty-state copy. Change from `"Start a chat with a friend"` to `"Start a chat with a friend or create a session to chat with your crew"` (or operator-chosen phrasing — defer to Mingla product voice).

### §3.6 Realtime layer

**Channel rename:** `discussion:${sessionId}` → `conversation:${conversation_id}`.

**postgres_changes subscriptions:**

- `INSERT` on `messages` filtered by `conversation_id=eq.${conversation_id}`.
- `UPDATE` on `messages` filtered by same (for edits + soft-delete).
- `INSERT|DELETE` on `message_reads` for read-receipt updates (no filter — same caveat as ORCH-0901 investigation §6.1 observation).
- `INSERT|DELETE` on `direct_message_reactions` (verify table — it's a single shared reactions table per investigation §3.5 OR a renamed/generalized version; implementor checks).

**broadcast events:** `message` (was `board_message`), `typing_start`, `typing_stop` — unchanged.

**Channel topology:** per-conversation channel; each member opens ONE channel per group conversation they participate in. Cleanup on unmount via `supabase.removeChannel(channel)`.

**Dual postgres_changes + broadcast preserved:** the implementor must port the dual-path pattern from `realtimeService.ts:473+` (currently for `board_messages`) to the new `messages` table for the conversation channel. Dedup-by-id client-side.

---

## §4 Success criteria (numbered, observable, testable)

| ID | Criterion | Verification |
|---|---|---|
| **SC-01** | Creating a `collaboration_sessions` row triggers `ensure_group_conversation_on_session_create` which atomically INSERTs a `conversations` row of `type='group', linked_entity_type='session', session_id=<id>, name=<session.name>`. | SQL probe post-insert: `SELECT id FROM conversations WHERE session_id = '<new_session>' AND linked_entity_type = 'session'` returns exactly 1 row. T-01 regression check. |
| **SC-02** | Flipping `session_participants.has_accepted` from `false` → `true` (or inserting with `has_accepted=true`) triggers `sync_session_member_to_conversation` which INSERTs a `conversation_participants` row. | SQL probe: `SELECT user_id FROM conversation_participants WHERE conversation_id = <session_conv> AND user_id = <accepted_user>` returns 1 row. T-02 regression check. |
| **SC-03** | DELETing a `session_participants` row triggers `remove_session_member_from_conversation` which DELETES the corresponding `conversation_participants` row. | SQL probe: post-delete count drops by 1. T-03 regression check. |
| **SC-04** | Friends-tab list (`ConnectionsPage`) shows group conversations alongside DMs. Group rows render with multi-avatar header + session-name title. | Operator-assisted iOS sim + Android emu smoke: create a collab session with 2 friends accepted, observe Friends tab shows the group row with 3-avatar stack + session name. T-04 + TA-04 regression check. |
| **SC-05** | Tapping the group chat from Friends-tab opens a thread whose `conversation_id` equals the same `conversations.id` that the in-session `BoardDiscussionTab` (via `useSessionDiscussion`) reads. **Same thread, two views.** | Manual sim repro: send a message from Friends-tab thread, observe it appears in the in-session Discussions tab in real-time + vice versa. T-05 regression check. |
| **SC-06** | Existing Discussions-tab features all preserved post-refactor: text send, image attachment, mentions render, reply quote, edit, soft-delete, reactions, read receipts, typing indicator, presence. | Manual sim repro: exercise each feature on a session-group chat; T-06 regression check (structural — feature wiring exists in the new render path); operator-assisted smoke. |
| **SC-07** | **CRITICAL SECURITY TEST:** User C who is NOT a member of session A receives ZERO rows when SELECTing messages from session A's conversation. RLS-enforced. | Independent SQL probe (operator or tester runs against staging or test user): `SELECT count(*) FROM messages WHERE conversation_id = '<session_A_conv>'` as User C returns 0. **MANDATORY tester adversarial TA-01.** |
| **SC-08** | When a user is DELETED from `session_participants` (e.g., session-leave action), they immediately lose access — the corresponding `conversation_participants` row is also deleted (via Step 3 trigger). On next read of the conversation, RLS returns 0 rows. | T-03 + TA-03 verification. |
| **SC-09** | Round-start system messages (`messages` rows with `sender_id IS NULL`) from ORCH-0899 [Plan another outing] render as centered muted rows in the chat AND count toward `unread_count` (per ORCH-0901 NULL-sender fix at commit `bb74655b`). | Independent SQL insert with `sender_id=NULL`; ORCH-0901 regression script's NULL-sender adversarial test (TA-08 of ORCH-0901 = TA-10 here) verifies unread count increments. T-09 regression check. |
| **SC-10** | `notify-message` edge function delivers a push to every group-chat participant except the sender, respecting `conversation_participants.notifications_muted`. OneSignal template renders correctly: direct = `<sender>: <preview>`, group = `<sender> in <name>: <preview>`. Deep-link payload includes `?type=<direct|group>&sessionId=<s>?` per §3.2. | Operator-assisted sim repro: send a message from a 2nd account, observe push notification on 1st account device with correct title format. T-10 regression check (structural — verifies edge function source). |
| **SC-11** | Data migration backfills 100% of non-deleted `board_messages` rows into `messages`. Row-count assertion in the migration body (§3.1 Step 7f) prevents the migration from completing on mismatch. Snapshot table `_archive_orch_0898_board_messages_pre_migration` exists post-migration. | SQL probe post-migration: `SELECT count(*) FROM board_messages WHERE deleted_at IS NULL` MUST equal `SELECT count(*) FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE linked_entity_type = 'session')`. T-11 + TA-04 regression check (T-11 verifies the migration body contains the assertion; TA-04 runs the migration in a dry-run and verifies the assertion catches a synthetic discrepancy). |
| **SC-12** | Self-add to a group conversation is FORBIDDEN by RLS. Direct conversation self-add (existing DM lazy-creation) still works. | TA-03 adversarial test: independent INSERT attempt by non-member returns 403 / RLS violation. |
| **SC-13** | The new group-conversation rows do NOT regress ORCH-0901's `I-FRIENDS-TAB-COLD-LOAD-UNDER-2S` invariant. `messagingService.getConversations` cold-load for N=20 (mix of direct + group) completes in <2.0s. | Re-run `app-mobile/scripts/ci/orch-0901-regression-check.mjs` post-ORCH-0898 implementation — 13/13 must still PASS. TA-09 explicitly re-runs ORCH-0901's perf invariant. |
| **SC-14 (Tr6 inheritance)** | The new DB columns + RLS policies support a trip-case row (`linked_entity_type='trip', event_id=<id>, is_broadcast_only=true|false`) without any consumer-app UI code change. RLS read works for `brand_team_members`. RLS broadcast-only INSERT blocks buyer-side, permits brand-team-member side. | TA-02 + TA-04 + TA-06 adversarial tests against a synthetic trip-conversation row. |
| **SC-15 (broadcast-only RLS)** | When `conversations.is_broadcast_only=true` AND `linked_entity_type='trip'`, an INSERT into `messages` by a `conversation_participants` member who is NOT a brand_team_member fails with 42501. An INSERT by a `brand_team_members` member SUCCEEDS. | TA-02 adversarial: two parallel inserts; non-brand fails, brand succeeds. |

---

## §5 Invariants

### §5.1 Preserved (existing)

| ID | How preserved |
|---|---|
| **I-PROPOSED-J** (Zustand persist holds IDs, not server records) | Refactor introduces no Zustand. Chat roster + messages stay in React Query. T-08 regression check verifies no `usePersist`-style hook is added. |
| **I-SUPABASE-NEQ-NULL-DISCIPLINE** (per `feedback_supabase_neq_null.md`) | New unread-count queries inherit ORCH-0901's `.or()` pattern. NO new `.neq()` on a nullable column. TA-08 adversarial. |
| **I-RLS-RETURNING-OWNER-GAP-MITIGATION** (per `feedback_rls_returning_owner_gap.md`) | All new RLS policies use inline EXISTS subqueries. Trigger functions are SECURITY DEFINER (correct — DB trigger context, not SELECT policy). TA-07 adversarial. |
| **Solo/DM parity** (per `feedback_solo_collab_parity.md`) | DM behaviour verified unchanged across all 10 happy-path + 10 adversarial tests. |
| **Append-only test contract** (per ORCH-0840 [Regression-test enforcement + append-only CI]) | Both new regression scripts are NEW files. No pre-existing test files modified. |
| **Constitution #2 (One owner per truth)** | `messages` is the canonical message store. `board_messages` retained as read-only legacy adapter during dual-read transition; ORCH-0902 retires it. No competing write-owners. |
| **Constitution #3 (No silent failures)** | Broadcast-only RLS rejection surfaces a user-friendly toast via the existing Toast component pattern (`feedback_toast_needs_absolute_wrap.md`). Edge function errors surface via existing error contract. |
| **Constitution #8 (Subtract before adding)** | `board_messages` write methods on `boardMessageService`/`boardDiscussionService` are BLOCKED (throw `[TRANSITIONAL] ORCH-0898 dual-read: writes via messagingService only`). Read methods adapted to read from unified substrate. |
| **Constitution #9 (No fabrication)** | Orphaned senders show 'Unknown' / 'Deleted User' labels (ORCH-0901 precedent). Group conversations without participants don't render fake activity. |
| **Constitution #13 (Exclusion consistency)** | `is('deleted_at', null)` filter applied consistently in both `messages` SELECT queries AND in the migration backfill (only non-deleted board_messages are backfilled). |
| **I-FRIENDS-TAB-COLD-LOAD-UNDER-2S** (ACTIVE post-ORCH-0901) | Group conversations added to the list do not regress the <2s cold-load. SC-13 + TA-09 verify. |

### §5.2 New (introduced — DRAFT until ORCH-0898 CLOSE)

| ID | Definition | Enforcement |
|---|---|---|
| **I-PROPOSED-CHAT-SUBSTRATE-UNIFIED** | `conversations`+`messages` is the canonical chat substrate. No new chat tables (e.g., `event_threads` from the Tr6 milestone draft) may be created. ORCH-0902 will additionally retire `board_messages` after the dual-read window. | CI gate via strict-grep on `CREATE TABLE.*_messages\|CREATE TABLE.*_threads` in `supabase/migrations/` post-CLOSE — must match only the legacy `board_messages` + `event_thread_*` archive references + the `_archive_orch_0898_*` snapshot. T-10 regression check + TA-08 adversarial. |
| **I-PROPOSED-CHAT-ROSTER-TRIGGER-DRIVEN** | `conversation_participants` rows for `type='group'` linked to a session are written ONLY by `sync_session_member_to_conversation` trigger or removed by `remove_session_member_from_conversation` trigger. App-code path forbidden by RLS (Step 6d tightening). | RLS policy + TA-03 adversarial. |
| **I-PROPOSED-NULL-SENDER-MEANS-SYSTEM-MESSAGE** | Any `messages` row with `sender_id IS NULL` is rendered by the consumer-app as a system message (centered muted row, no reactions/replies/mentions). Unread counts include them (ORCH-0901 fix). | T-09 + TA-10 + render-layer code review in implementor's report. |
| **I-PROPOSED-CONVERSATIONS-LINKED-ENTITY-COHERENT** | Each conversation row has exactly one of `session_id` / `event_id` populated (per `linked_entity_type`), or neither (for `'direct'`). | DB CHECK constraint `conversations_linked_entity_coherent` (Step 1). T-01 + TA-04 + TA-06 verify by attempting bad-state inserts. |

---

## §6 Test cases

### §6.1 Implementor happy-path regression script

**Path:** `app-mobile/scripts/ci/orch-0898-regression-check.mjs` (per Working-Branch Discipline — mirrors ORCH-0854 + ORCH-0901 pattern).

| ID | Scenario | Verification | Layer |
|---|---|---|---|
| T-01 | New columns + indexes + CHECK constraints exist on `conversations` + `messages` + `conversation_participants` | Read migration file, grep for each ALTER TABLE / CREATE INDEX / CHECK statement | DB |
| T-02 | Both triggers (`ensure_group_conversation_on_session_create` + `sync_session_member_to_conversation`) defined with correct WHEN guards | Read migration file, grep for `CREATE TRIGGER`, verify `WHEN (NEW.has_accepted = true)` for sync trigger | DB |
| T-03 | Removal trigger `remove_session_member_from_conversation` defined for session-leave handling | Read migration file, grep for `AFTER DELETE ON public.session_participants` | DB |
| T-04 | RLS policies `conversations_brand_team_member_read` + `messages_brand_team_member_read` + `messages_broadcast_only_enforcement` defined with inline EXISTS subqueries (NOT SECURITY DEFINER helpers in their bodies) | Read migration file, grep for `CREATE POLICY`, AST-check that body contains `EXISTS (...)` directly | DB |
| T-05 | `conversation_participants_direct_self_add` policy replaces the old too-permissive one — restricts self-add to `c.type = 'direct'` | Read migration file, grep for `DROP POLICY.*Users can add themselves` AND `CREATE POLICY conversation_participants_direct_self_add` with WITH CHECK clause referencing `c.type = 'direct'` | DB |
| T-06 | `messagingService.getOrCreateGroupConversationForSession` method exists, uses `.eq('session_id', ...).eq('linked_entity_type', 'session').maybeSingle()` | Read messagingService.ts, grep | Service |
| T-07 | `useSessionDiscussion` reads from `messagingService` (NOT `boardDiscussionService`) | Read useSessionDiscussion.ts, grep for `messagingService` import + absence of `boardDiscussionService` import (or only as deprecated wrapper) | Hook |
| T-08 | `ChatListItem` has a `conversation.type === 'group'` branch in render | Read ChatListItem.tsx, grep | Component |
| T-09 | `MessageBubble` (discussion AND chat folders) handles `sender_id === null` as system message render | Read both MessageBubble.tsx files, grep for `sender_id === null` or equivalent | Component |
| T-10 | No NEW `_messages` / `_threads` / `event_threads` table introduced; only the migration's expected ALTER TABLEs (I-PROPOSED-CHAT-SUBSTRATE-UNIFIED) | Migration file grep: `CREATE TABLE.*\(_messages\|_threads\|event_thread\)` returns ONLY the expected `_archive_orch_0898_*` snapshot | DB |

**fails-on-revert:** implementor stashes the migration file + service/hook/component changes, re-runs script, verifies at minimum T-01 + T-02 + T-06 + T-07 + T-08 FAIL. Restores, all PASS. Cites commit hash in implementation report.

### §6.2 Tester adversarial regression script

**Path:** `app-mobile/scripts/ci/orch-0898-adversarial-check.mjs` — attacks DIFFERENT angles than happy-path.

| ID | Scenario | Verification | Angle |
|---|---|---|---|
| TA-01 | **CRITICAL SECURITY:** non-participant SELECT on group conversation messages returns ZERO rows (SC-07) | Independent SQL probe via Supabase Management API or staging; tester writes a synthetic non-member user + attempts to read another session's messages; expected: 0 rows AND no 403 error (RLS-correct: empty result) | Security |
| TA-02 | **Broadcast-only INSERT enforcement** (SC-15) — non-brand-team-member INSERT into a `type='trip', is_broadcast_only=true` conversation fails with 42501; brand-team-member INSERT succeeds | Independent dual-INSERT probe; one as a `conversation_participants` member (fails); one as a `brand_team_members` member (succeeds) | Security |
| TA-03 | Self-add to group conversation FORBIDDEN (SC-12) | Independent INSERT into `conversation_participants` for a `type='group'` row by a non-trigger path returns RLS violation | Security |
| TA-04 | **Migration row-count assertion catches mismatch.** Synthetic test: insert N `board_messages` rows, run migration with intentional discrepancy (skip one row's backfill), verify the DO $$ block in Step 7f raises EXCEPTION | Migration unit test (SQL DO block) | DB integrity |
| TA-05 | Mention payload roundtrip: insert message with `mentions: ['user-X']`, read back, verify the mentions array preserved | SQL roundtrip probe | Data integrity |
| TA-06 | Coherence CHECK enforcement: attempt to INSERT a `conversations` row with `linked_entity_type='session', event_id=<id>` (invalid combo) — must fail with CHECK violation | INSERT probe | Schema integrity |
| TA-07 | **NO SECURITY DEFINER helper in any new SELECT policy** (I-PROPOSED-J + RLS-RETURNING-OWNER-GAP defense). AST scan of migration file: `CREATE POLICY.*FOR SELECT` body must NOT call any function named `*_has_thread_access` or similar | Migration AST grep | Architecture defense |
| TA-08 | **NO new chat-message table** beyond expected (`_messages`/`_threads` patterns appear only in expected places). AST grep of migration file | Architecture defense | I-PROPOSED-CHAT-SUBSTRATE-UNIFIED |
| TA-09 | **ORCH-0901 perf invariant intact:** re-run `app-mobile/scripts/ci/orch-0901-regression-check.mjs` post-ORCH-0898 — 13/13 must still PASS | Cross-ORCH regression | Performance |
| TA-10 | **NULL-sender system message round-trip:** insert a `messages` row with `sender_id=NULL`, content="System: X", into a session-linked conversation. Verify ORCH-0901's `getConversations` correctly increments unread_count (cross-ORCH integration test) | SQL insert + service call | Cross-ORCH integration |

**fails-on-revert:** tester stashes the migration + service/hook/component changes, re-runs adversarial script, verifies at minimum TA-01 + TA-02 + TA-04 + TA-09 + TA-10 FAIL. Restores, all PASS. Cites commit hash in QA report.

### §6.3 Test mod token

**Append-only contract per ORCH-0840:** both new test scripts are NEW files. If a pre-existing CI script needs ANY modification (e.g., adding the new test files to an aggregate runner), the closing commit body MUST include `[TEST-MOD-APPROVED ORCH-0898]`.

---

## §7 Implementation order

The implementor follows this sequence — binding. DB + RLS + critical security test FIRST, before any UI work, per investigation §11.

1. **Pre-flight (Step 0):** read this SPEC + investigation report + ORCH-0901 implementation report + Tr6 milestone. Verify the brand_team_members table name correction (§1.4) hasn't been silently re-introduced as `brand_members` anywhere in the migration draft.
2. **Migration file:** write `supabase/migrations/20260624000000_orch_0898_unified_chat_substrate.sql` per §3.1 Steps 1-8. Use the exact column names, constraint names, trigger names, policy names defined here.
3. **Operator applies migration:** STOP and hand back to operator for `supabase db push --linked`. No client code ships until the migration is on remote. Verify via `mcp__supabase__list_migrations`.
4. **CRITICAL SECURITY TEST FIRST (per investigation §11):** write a tester-style SQL probe that attempts cross-session reads as a non-member. Run independently against staging or test data. Must return zero rows. Block all subsequent steps if this fails.
5. **Edge function update:** modify `supabase/functions/notify-message/index.ts` per §3.2. Operator hands off deploy to orchestrator (per Orchestrator deploy split protocol) — `/Users/sethogieva/bin/supabase functions deploy notify-message --project-ref gqnoajqerqhnvulmnyvv`. Orchestrator verifies version bump.
6. **Service layer:** modify `messagingService.ts` per §3.3 — add `getOrCreateGroupConversationForSession`. Add `leaveGroupConversation` method (for the ChatListItem swipe-leave action). Add the broadcast-only error translation in the `sendMessage` catch block.
7. **Service-layer dual-read adapter:** modify `boardMessageService.ts` + `boardDiscussionService.ts` — add the `@deprecated` JSDoc; reroute read methods to read from `messages` filtered to the session's conversation_id; throw on write methods with `[TRANSITIONAL] ORCH-0898 dual-read: writes via messagingService only`.
8. **Hook layer:** rewrite `useSessionDiscussion.ts` per §3.4. Migrate query key. Rebind realtime channel name + filter + broadcast event.
9. **Component layer:**
   - Modify `connections/ChatListItem.tsx` to add the `type === 'group'` branch.
   - Create `connections/MultiAvatarStack.tsx` (or inline equivalent).
   - Add system-message render branch to BOTH `discussion/MessageBubble.tsx` AND `chat/MessageBubble.tsx`.
10. **`notify-message` consumer-app deep-link handler:** verify the consumer-app's existing OneSignal deep-link handler routes `mingla://chat/<conv>?type=group&sessionId=<s>` to the right screen (Friends-tab list with the conversation auto-opened, OR the in-session Discussions tab — operator preference; investigation §13 Q12 default = open Friends-tab list).
11. **Regression tests:**
    - Write `app-mobile/scripts/ci/orch-0898-regression-check.mjs` (§6.1).
    - Add `test:orch-0898` to `app-mobile/package.json`.
    - Run, verify 10/10 PASS.
    - Verify fails-on-revert (stash + run + verify failures + restore + verify PASS).
12. **Constitutional + parity checks:** verify all 14 Constitution rules + solo/DM parity in implementation report.
13. **Operator-assisted iOS sim + Android emu smoke:** per parity-enforcement rule, run on BOTH platforms. Create a collab session → verify group chat appears in Friends tab → send a message from both views → verify same thread → invite a 2nd account → verify auto-join → simulate session-leave → verify auto-leave from chat.
14. **Implementation report:** write `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0898_COLLAB_GROUP_CHAT.md` with old→new receipts, test counts, fails-on-revert hash, sim smoke results, discoveries.

---

## §8 Regression prevention

### §8.1 Structural safeguards

- **Both regression scripts immutable per ORCH-0840:** future ORCHs touching the chat substrate cannot delete `orch-0898-regression-check.mjs` or `orch-0898-adversarial-check.mjs`; must extend.
- **DB CHECK constraints:** `conversations_linked_entity_coherent` + `conversations_group_requires_name` permanently lock the data shape — future writes must satisfy or fail at DB layer.
- **DB UNIQUE indexes:** `conversations_unique_session_id` + `conversations_unique_event_id` prevent duplicate group conversations per linked entity.
- **Trigger-driven roster:** `conversation_participants` writes for groups go through triggers only (RLS Step 6d enforces).
- **Append-only CI workflow** (`.github/workflows/tests-append-only.yml`) blocks regression test deletions per ORCH-0840.

### §8.2 Optional CI strict-grep gates (P3 follow-up)

Per `feedback_strict_grep_registry_pattern.md`:

- `.github/scripts/strict-grep/i-proposed-chat-substrate-unified.mjs` — scans `supabase/migrations/` for `CREATE TABLE.*\(_messages\|_threads\|event_thread\)` patterns; exit 1 if matched outside the expected `_archive_orch_0898_*` snapshot.
- `.github/scripts/strict-grep/i-proposed-chat-roster-trigger-driven.mjs` — scans `app-mobile/src/` + `mingla-business/src/` for direct INSERT into `conversation_participants` outside service-layer paths; exit 1 if matched.

**Implementor decision:** ship gates in ORCH-0898 (lower follow-up cost, immediate protection) OR defer. Recommend ship informational (exit 0) for v1, promote to blocking (exit 1) in a follow-up ORCH after metric confirmation.

### §8.3 Protective comments

The migration's lead comment names the I-PROPOSED-CHAT-SUBSTRATE-UNIFIED invariant + cross-references both regression scripts:

```sql
-- ORCH-0898 [Consumer collab session → Friends-tab group chat] migration.
-- This migration establishes I-PROPOSED-CHAT-SUBSTRATE-UNIFIED: conversations+messages is
-- the ONLY canonical chat substrate. board_messages is retained 1 release as backing data
-- (ORCH-0902 retires it). NO new chat-message tables may be created — verified by CI gate
-- i-proposed-chat-substrate-unified.mjs and tester adversarial TA-08.
```

---

## §9 Open questions LOCKED with defaults

Per investigation §12 + operator-recommended defaults — these are now binding:

| # | Question | LOCKED ANSWER |
|---|---|---|
| Q1 | Auto-leave chat on session-leave, OR retain read-only history? | **Auto-leave.** Trigger `remove_session_member_from_conversation` DELETES conversation_participants row on session_participants DELETE. v2 polish may add read-only history mode. |
| Q2 | Non-members invited to group chat (mixed-membership)? | **NO.** Roster strictly mirrored to session_participants. v2 might add. |
| Q3 | Host moderator powers (remove member, edit anyone's message, pin)? | **NO moderator powers in v1.** Host-remove via session-side action only (existing); no chat-side host actions. |
| Q4 | Chat name editable? By whom? | **Default `conversations.name = collaboration_sessions.name`** via Step 4 trigger. Editable by session host only via a new `messagingService.updateGroupConversationName(conversation_id, name)` method (defer to operator if not ship-blocking; recommend defer). v1 = trigger-default, not user-editable. |
| Q5 | Message edit + delete allowed for v1? | **Edit YES** (15-min window UI-only via existing edit affordance; RLS UPDATE policy `Users can update their own messages` line 14894 already permits). **Delete NO for v1** — RLS DELETE policy `Users can delete their own messages` line 14609 exists but UI deactivates the delete action for group conversations. |
| Q6 | Attachments in v1? | **Images only** (preserve current Discussions-tab feature via the existing `image_url` migration to `file_url` + `message_type='image'`). Files / videos / cards defer to v2. |
| Q7 | `conversations.name` for direct conversations | **NULL** — derived from participants at render time. CHECK constraint `conversations_group_requires_name` enforces. |
| Q8 | OneSignal push template — same as DM or separate? | **Same template, conditional copy.** Direct: `<sender>: <preview>`. Group: `<sender> in <name>: <preview>`. Single edge-function path. |
| Q9 | `board_messages` table fate post-migration | **Retain 1 release as backing data.** ORCH-0902 retires after dual-read window. Backup snapshot retained 14 days then dropped via scheduled cleanup. |
| Q10 | ORCH-0899 round-start system message format | **`sender_id IS NULL`** + content = `"<host_name> is planning another outing — tap to join the swipe"`. card_payload = `{"kind": "round_started", "round_id": "<id>"}` for client-side click handling. ORCH-0901 NULL-sender unread fix already supports counting these as unread. |
| Q11 | Roster on session `status='completed'` vs `'archived'` | **`completed`:** chat stays active (round-aware — supports ORCH-0899). **`archived`:** chat is read-only via consumer-app render gate (no new DB column needed for v1 — derived from `collaboration_sessions.status`; sendMessage UI hides input when status='archived'). |
| Q12 | OneSignal deep-link format for group chat | **`mingla://chat/<conv>?type=group&sessionId=<s>`** for session-linked groups; **`mingla://chat/<conv>?type=group&eventId=<e>`** for trip-linked groups (Tr6 future). |

---

## §10 Discoveries for Orchestrator

1. **🟠 [P2] CORRECTION: investigation + dispatch + Tr6 milestone all incorrectly reference `brand_members` table.** Actual table is `brand_team_members` (baseline migration line 7740). This SPEC uses the correct name and the active-membership predicate (`accepted_at IS NOT NULL AND removed_at IS NULL`). **Orchestrator should backport the correction into the investigation report + Tr6 milestone artifact + ORCH-0897 SCOPE UPDATE entry in WORLD_MAP** as a documentation hygiene pass. The correction does NOT change the substrate decision but does change the RLS policy bodies that ORCH-0897 will need to reference.

2. **🟡 [P3] Tr6 milestone artifact at `Mingla_Artifacts/milestones/Tr6_DISCUSSION_BOARD.md` has its `event_threads` schema in §5 + `has_thread_access` SECURITY DEFINER helper inline.** That schema is superseded by this SPEC's unified substrate (per operator-locked D3 + WORLD_MAP ORCH-0897 SCOPE UPDATE entry). The Tr6 milestone file should be annotated with a `SUPERSEDED BY ORCH-0898 SPEC` banner referencing this file. Orchestrator updates as part of CLOSE Step 5 (deprecation extension does NOT apply here — Tr6 milestone is a planning artifact, not a decommissioned production system, but a header annotation prevents future readers from following the stale schema).

3. **🟡 [P3] `messagingService.getMessages` line 600 still has the N+1 enrichMessage pattern.** Out of scope for ORCH-0898 (investigation §8 #2 + ORCH-0901 §12 #2). Recommend follow-up ORCH after ORCH-0898 CLOSE — the per-conversation message-list refactor benefits from the same single-JOIN pattern ORCH-0901 proved viable.

4. **🟡 [P3] `boardMessageService.ts` deprecation comment.** The 901-line legacy class will become read-only adapters during dual-read. Recommend a documentation deprecation file alongside (`Mingla_Artifacts/decommissioned/board_messages_service.md`) so future investigators can find the rationale + retirement date.

5. **🔵 [P4] `useMessages.ts` dead-code cleanup (ORCH-0900) is independent.** This SPEC does not touch `useMessages.ts`. The dual-Conversation type collision (server-shape in `messagingService.ts:211` vs UI-shape in `useMessages.ts:34`) persists post-ORCH-0898. ORCH-0900 is the right ORCH to resolve it — recommend operator schedule after ORCH-0898 CLOSE.

6. **🔵 [P4] Realtime channel rename creates a brief in-flight gap during deploy.** During the deploy window (after edge fn deploys but before all clients hot-swap to the new channel name), some messages might be missed by clients still subscribed to `discussion:${sessionId}`. Mitigation: dual-subscribe on the new channel name `conversation:${conv_id}` AND keep the old `discussion:${sessionId}` channel subscription for 1 release; ORCH-0902 retires the old channel name. Negligible practical impact (<5min deploy window, missed messages re-load on app foreground via React Query refetch). Note for implementation report.

---

## §11 Layman summary

This SPEC tells the implementor exactly how to ship the **collab-session group chat in the Friends tab** that the operator asked for at the start of the session.

The plan, in plain English:

1. **One database migration** adds 6 new columns to the conversations table (so it can link to a collab session or a trip) + 1 new column to the messages table (for `@mentions`) + 2 triggers that automatically create the group chat when a session is created AND auto-add people when they accept the session invite + 1 trigger that auto-removes them when they leave + a one-time data copy from the old `board_messages` table into the unified `messages` table + a backup snapshot table for safety.
2. **One edge function (`notify-message`) gets simpler** — instead of 5 different "type" codes, everything is just "message". Push notifications work the same as before but with cleaner code.
3. **One service method added** to `messagingService` (the one ORCH-0901 just made fast) + the legacy `boardMessageService` becomes a read-only stub that proxies to the new substrate, with writes blocked.
4. **One hook (`useSessionDiscussion`) gets rewired** to read from the new unified substrate instead of the legacy `board_messages` table. Components consuming it don't see any difference.
5. **One UI component (`ChatListItem`) gets a `type === 'group'` branch** that shows multiple avatars stacked + the session name. The Discussions tab inside the session view modal keeps working because the hook's data shape is preserved.
6. **System messages with `sender_id IS NULL`** render as centered muted rows — this is what ORCH-0899 [Plan another outing] will use for "round 2 has started" announcements. The ORCH-0901 NULL-sender unread fix already makes them count correctly.
7. **Two regression test scripts** lock everything in — 10 happy-path + 10 adversarial structural checks at `app-mobile/scripts/ci/orch-0898-{regression,adversarial}-check.mjs` matching the proven ORCH-0854 + ORCH-0901 pattern.
8. **ORCH-0897's trip group chat (Tr6) inherits everything** built here. The Tr6 SPEC just adds the trip-buyer UI on top — no new substrate, no new chat table.

The critical safety thing: the data backfill happens **inside the same migration as the schema changes** — if anything goes wrong, the whole thing rolls back automatically and the database is untouched. Plus a backup snapshot table (`_archive_orch_0898_board_messages_pre_migration`) is created so we can recover if a bug surfaces post-deploy. Plus the cross-session security test (a user trying to read another session's chat must get zero rows) is **mandatory and runs FIRST**, before any UI code ships — per investigation §11 risk-mitigation order.

The biggest discovery while writing this SPEC: the investigation, dispatch, and Tr6 milestone all called the brand-membership table `brand_members`, but it's actually `brand_team_members` (verified by reading the baseline migration this turn). The SPEC uses the correct name throughout. Orchestrator should backport this correction into the older artifacts.

---

**SPEC path:** `Mingla_Artifacts/specs/SPEC_ORCH-0898_COLLAB_GROUP_CHAT.md`
**Status:** Ready for orchestrator REVIEW. Implementor dispatch follows on APPROVAL. Operator applies migration via `supabase db push --linked` AFTER implementor writes the migration file; orchestrator deploys edge function `notify-message` after operator migration confirmation.

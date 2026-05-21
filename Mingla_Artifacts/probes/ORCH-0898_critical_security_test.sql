-- ORCH-0898 [Consumer collab session → Friends-tab group chat] CRITICAL SECURITY TEST
--
-- Per SPEC §7 step 3 + investigation §11 — this probe MUST be run before any client code
-- ships against the unified chat substrate. The probe verifies cross-session RLS isolation:
-- a non-member must receive ZERO rows when attempting to read another session's group
-- conversation messages.
--
-- HOW TO RUN: this is meant for the tester / operator to run against STAGING with two
-- distinct test user JWTs. Do NOT run blocks 3-6 in production with real users.
--
-- Block 1 (production-safe — read-only schema verification): can run anywhere.
-- Block 2 (production-safe — runtime trigger verification on synthetic data): creates +
--   tears down test rows; safe to run in production but generates noise. Recommend staging.
-- Blocks 3-6 (STAGING ONLY — cross-session RLS verification with auth.uid() simulation):
--   require service-role + auth.uid() context manipulation; do not run in production.
--
-- After running: if any check fails, block ALL subsequent ORCH-0898 implementation phases
-- per SPEC §7 step 3 ("Block all subsequent steps if this fails").

-- ─────────────────────────────────────────────────────────────────────────────
-- BLOCK 1 — Schema sanity (read-only, production-safe)
-- ─────────────────────────────────────────────────────────────────────────────

SELECT 'SC-01: ensure_group_conversation_on_session_create trigger present' AS check_name,
       EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='ensure_group_conversation_on_session_create') AS pass
UNION ALL
SELECT 'SC-02: mirror_session_participant_to_conversation trigger present',
       EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='mirror_session_participant_to_conversation')
UNION ALL
SELECT 'SC-03: remove_session_participant_from_conversation trigger present',
       EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='remove_session_participant_from_conversation')
UNION ALL
SELECT 'SC-07-prep: existing "Users can view conversations they participate in" SELECT policy on conversations',
       EXISTS (SELECT 1 FROM pg_policies WHERE tablename='conversations' AND policyname='Users can view conversations they participate in')
UNION ALL
SELECT 'SC-07-prep: existing inline-EXISTS message-read policy on messages',
       EXISTS (SELECT 1 FROM pg_policies WHERE tablename='messages' AND cmd='SELECT')
UNION ALL
SELECT 'SC-12: conversation_participants_direct_self_add restricts to type=direct',
       EXISTS (SELECT 1 FROM pg_policies WHERE tablename='conversation_participants' AND policyname='conversation_participants_direct_self_add')
UNION ALL
SELECT 'SC-12: legacy "Users can add themselves to conversations" DROPPED',
       NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='conversation_participants' AND policyname='Users can add themselves to conversations')
UNION ALL
SELECT 'SC-15: messages_broadcast_only_enforcement is AS RESTRICTIVE',
       EXISTS (SELECT 1 FROM pg_policies WHERE tablename='messages' AND policyname='messages_broadcast_only_enforcement' AND permissive='RESTRICTIVE')
UNION ALL
SELECT 'I-PROPOSED-CHAT-SUBSTRATE-UNIFIED: no event_threads or event_thread_messages tables created',
       NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename IN ('event_threads', 'event_thread_messages'));

-- Expected: all 9 checks return pass=true.

-- ─────────────────────────────────────────────────────────────────────────────
-- BLOCK 2 — Trigger runtime verification (staging recommended)
-- ─────────────────────────────────────────────────────────────────────────────
--
-- This block creates a synthetic session + participant + tear-down, verifying the 3
-- triggers actually fire. Should complete in <1 second with all rows cleaned up.
--
-- DO $$
-- DECLARE
--   v_test_user_a uuid := gen_random_uuid();  -- synthetic creator
--   v_test_user_b uuid := gen_random_uuid();  -- synthetic member
--   v_test_session_id uuid;
--   v_conv_id uuid;
--   v_creator_participant_count int;
--   v_member_participant_count_before int;
--   v_member_participant_count_after int;
--   v_member_participant_count_post_delete int;
-- BEGIN
--   -- Note: collaboration_sessions has FK constraints — using NULL created_by + a
--   -- synthetic name. Verify ensure_group_conversation_on_session_create fires.
--   INSERT INTO collaboration_sessions (name, created_by, status, session_type)
--     VALUES ('ORCH-0898 trigger test', NULL, 'pending', 'group_hangout')
--     RETURNING id INTO v_test_session_id;
--
--   SELECT id INTO v_conv_id FROM conversations
--    WHERE session_id = v_test_session_id AND linked_entity_type = 'session';
--
--   IF v_conv_id IS NULL THEN
--     DELETE FROM collaboration_sessions WHERE id = v_test_session_id;
--     RAISE EXCEPTION 'TRIGGER FAIL — ensure_group_conversation_on_session_create did not create conversation';
--   END IF;
--
--   -- Synthetic participant accept (with synthetic user_id — RLS off since DO block runs as superuser).
--   INSERT INTO session_participants (session_id, user_id, has_accepted, role)
--     VALUES (v_test_session_id, v_test_user_b, true, 'member');
--
--   SELECT count(*) INTO v_member_participant_count_after
--   FROM conversation_participants WHERE conversation_id = v_conv_id AND user_id = v_test_user_b;
--
--   IF v_member_participant_count_after = 0 THEN
--     DELETE FROM session_participants WHERE session_id = v_test_session_id;
--     DELETE FROM conversation_participants WHERE conversation_id = v_conv_id;
--     DELETE FROM conversations WHERE id = v_conv_id;
--     DELETE FROM collaboration_sessions WHERE id = v_test_session_id;
--     RAISE EXCEPTION 'TRIGGER FAIL — sync_session_member_to_conversation did not mirror accepted participant';
--   END IF;
--
--   -- Verify removal trigger.
--   DELETE FROM session_participants WHERE session_id = v_test_session_id AND user_id = v_test_user_b;
--
--   SELECT count(*) INTO v_member_participant_count_post_delete
--   FROM conversation_participants WHERE conversation_id = v_conv_id AND user_id = v_test_user_b;
--
--   IF v_member_participant_count_post_delete > 0 THEN
--     DELETE FROM conversation_participants WHERE conversation_id = v_conv_id;
--     DELETE FROM conversations WHERE id = v_conv_id;
--     DELETE FROM collaboration_sessions WHERE id = v_test_session_id;
--     RAISE EXCEPTION 'TRIGGER FAIL — remove_session_member_from_conversation did not remove participant';
--   END IF;
--
--   -- Tear-down.
--   DELETE FROM conversations WHERE id = v_conv_id;
--   DELETE FROM collaboration_sessions WHERE id = v_test_session_id;
--
--   RAISE NOTICE 'BLOCK 2 PASS — all 3 triggers fire correctly.';
-- END;
-- $$;
--
-- (Uncomment Block 2 only after confirming Block 1 passes. Run as service-role / postgres.
-- DO block is wrapped in a transaction — anything throws → automatic rollback.)

-- ─────────────────────────────────────────────────────────────────────────────
-- BLOCK 3-6 — Cross-session RLS isolation (STAGING ONLY)
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Requires: two real test users (USER_A + USER_B), with USER_A as a member of session S.
-- USER_B is NOT a member of S. The test verifies USER_B cannot read S's messages.
--
-- 1. Sign in as USER_A (via mobile app or Supabase JS client), create a collab session,
--    post a message. Note the session_id (call it S) and the conversation_id (call it CONV_S).
--
-- 2. Sign in as USER_B (separate device / incognito), run via Supabase JS client:
--
--    const { data, error } = await supabase
--      .from('messages')
--      .select('*')
--      .eq('conversation_id', 'CONV_S');
--    console.log({ data, error });
--
-- 3. Expected result:
--    - data: []     (empty array, NOT null — RLS-correct: empty result, no error)
--    - error: null  (NOT a 403 — RLS filters silently)
--
-- 4. Repeat as USER_B for the conversations table:
--    await supabase.from('conversations').select('*').eq('id', 'CONV_S');
--    Expected: data: [], error: null.
--
-- 5. Repeat as USER_B attempting self-add to CONV_S:
--    await supabase.from('conversation_participants').insert({ conversation_id: 'CONV_S', user_id: '<USER_B>' });
--    Expected: error.code === '42501' (RLS violation — conversation_participants_direct_self_add
--    only permits self-add for type=direct conversations, CONV_S is type=group).
--
-- 6. Optional Tr6 broadcast-only probe (requires a trip event + brand_team_members rows):
--    Create a trip conversation with linked_entity_type='trip', is_broadcast_only=true.
--    USER_A (non-brand-team-member but a conversation_participants) attempts INSERT into messages:
--    Expected: error.code === '42501' (messages_broadcast_only_enforcement RESTRICTIVE policy denies).
--    A brand_team_member of the trip's brand attempts INSERT:
--    Expected: success.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- VERDICT
-- ─────────────────────────────────────────────────────────────────────────────
--
-- ORCH-0898 implementation may proceed IF AND ONLY IF:
--   - Block 1: all 9 checks pass
--   - Block 2: all 3 trigger verifications pass (RAISE NOTICE 'BLOCK 2 PASS')
--   - Block 3-6: USER_B cross-session reads return empty + INSERTs return 42501
--
-- If ANY check fails, return to investigator/forensics with the failure mode.
-- Per SPEC §7 step 3: "Block all subsequent steps if this fails."

-- ─────────────────────────────────────────────────────────────────────────────
-- IMPLEMENTOR NOTES
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Block 1 was executed during Phase 2a (2026-05-21) by the implementor via
-- mcp__supabase__execute_sql against production. All 9 checks PASS. See
-- IMPLEMENTATION_ORCH-0898_COLLAB_GROUP_CHAT.md §6 for the result.
--
-- Block 2 was NOT executed by the implementor against production — synthetic-row
-- creation against the production DB is too risky and would generate noise. The
-- DO block is provided here for the tester to run in staging.
--
-- Blocks 3-6 are inherently runtime tests requiring two real authenticated users +
-- the mobile app or a JS client — out of scope for SQL-only execution. The tester
-- runs them as part of the QA pass with two staging accounts.

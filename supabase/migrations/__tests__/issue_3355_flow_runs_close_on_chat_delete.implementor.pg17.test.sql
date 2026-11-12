-- MINGLA-INVARIANT: I-ARI-RUNS-CLOSE-WITH-CHAT | issue #3355 | Deleting an Ari chat closes (cancelled, conversation_deleted_at set) every open flow run of that chat before its link is nulled, through the BEFORE DELETE trigger ari_flow_runs_close_on_chat_delete on agent_conversations; closed runs are left as they are; ari_flow_runs_expire_idle / _all also close any still-open run whose chat was deleted, whatever its idle time, and never touch a brand-wide run that has no chat.
--
-- Issue #3355 rework 9 (fix 3) — deleting a chat closes its flow run
-- (migration 20280702163355_issue_3355_flow_runs_close_on_chat_delete.sql).
-- Pins:
--   * deleting a chat (as the service role, the agent-conversation path)
--     cancels its open run and marks it; a completed run is untouched;
--   * the sweep (per person and global) closes an open run marked deleted,
--     as cancelled, even when it is fresh; a fresh brand-wide run with no
--     chat stays open; re-running the sweep changes nothing;
--   * the trigger function is not callable by clients.
-- Reverting the trigger or either sweep body makes a block below raise.

\set ON_ERROR_STOP on
BEGIN;

DO $i3355cd$
DECLARE
  v_owner uuid := '33550000-0000-4000-8000-0000000009a1';
  v_mate uuid := '33550000-0000-4000-8000-0000000009a2';
  v_brand uuid := '33550000-0000-4000-8000-0000000009b1';
  v_chat uuid := '33550000-0000-4000-8000-0000000009c1';
  v_chat2 uuid := '33550000-0000-4000-8000-0000000009c2';
  v_chat3 uuid := '33550000-0000-4000-8000-0000000009c3';
  v_r jsonb;
  v_open uuid;
  v_done uuid;
  v_marked uuid;
  v_brandwide uuid;
  v_n integer;
  v_row record;
BEGIN
  INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
    (v_owner,'owner-3355cd@example.invalid','{"full_name":"Ada Owner"}'),
    (v_mate,'mate-3355cd@example.invalid','{"full_name":"Sam Mate"}');
  INSERT INTO public.creator_accounts(id,created_at,updated_at) VALUES (v_owner,now(),now());
  INSERT INTO public.brands(id,account_id,name,slug,default_currency)
  VALUES (v_brand,v_owner,'Favy Lagos','favy-3355cd','NGN');
  INSERT INTO public.brand_team_members(brand_id,user_id,role,accepted_at)
  VALUES (v_brand,v_mate,'brand_admin',now());
  INSERT INTO public.agent_conversations(id,user_id,brand_id) VALUES
    (v_chat,v_owner,v_brand),(v_chat2,v_owner,v_brand),(v_chat3,v_mate,v_brand);

  -- ── Privilege ────────────────────────────────────────────────────────────
  IF has_function_privilege('authenticated','public.ari_flow_runs_close_for_deleted_chat()','EXECUTE')
     OR has_function_privilege('anon','public.ari_flow_runs_close_for_deleted_chat()','EXECUTE') THEN
    RAISE EXCEPTION 'the chat-delete trigger function must not be callable by clients';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
    WHERE t.tgrelid = 'public.agent_conversations'::regclass
      AND t.tgname = 'ari_flow_runs_close_on_chat_delete' AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION 'agent_conversations must carry ari_flow_runs_close_on_chat_delete';
  END IF;

  -- ── Delete closes the chat's open run (awaiting the owner) ──────────────
  v_r := public.ari_flow_run_start(v_owner,v_brand,'create_event',2,'one_per_subject',v_chat,NULL,'{}');
  v_open := (v_r->'run'->>'id')::uuid;
  UPDATE public.ari_flow_runs SET status = 'awaiting_owner' WHERE id = v_open;
  v_r := public.ari_flow_run_start(v_owner,v_brand,'create_event',2,'one_per_subject',v_chat2,NULL,'{}');
  v_done := (v_r->'run'->>'id')::uuid;
  UPDATE public.ari_flow_runs
  SET status = 'completed', completed_at = now(), completion_evidence = '{"draft":"x"}'
  WHERE id = v_done;

  SET LOCAL ROLE service_role;
  DELETE FROM public.agent_conversations WHERE id IN (v_chat, v_chat2);
  RESET ROLE;

  SELECT status, conversation_id, conversation_deleted_at, lease_token
  INTO v_row FROM public.ari_flow_runs WHERE id = v_open;
  IF v_row.status <> 'cancelled' OR v_row.conversation_id IS NOT NULL
     OR v_row.conversation_deleted_at IS NULL OR v_row.lease_token IS NOT NULL THEN
    RAISE EXCEPTION 'deleting the chat must cancel its open run, got % / % / %',
      v_row.status, v_row.conversation_id, v_row.conversation_deleted_at;
  END IF;
  SELECT status, conversation_deleted_at INTO v_row FROM public.ari_flow_runs WHERE id = v_done;
  IF v_row.status <> 'completed' OR v_row.conversation_deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'a completed run must stay as it was, got % / %',
      v_row.status, v_row.conversation_deleted_at;
  END IF;

  -- ── The sweep closes a still-open run whose chat was deleted ────────────
  -- (fresh activity: only the deleted-chat rule can close it)
  INSERT INTO public.ari_flow_runs(brand_id,flow_key,flow_version,concurrency,started_by,
    conversation_id,status,conversation_deleted_at)
  VALUES (v_brand,'create_event',2,'one_per_subject',v_owner,NULL,'awaiting_owner',now())
  RETURNING id INTO v_marked;
  -- A brand-wide run with no chat, fresh: never closed by this rule.
  INSERT INTO public.ari_flow_runs(brand_id,flow_key,flow_version,concurrency,started_by,
    conversation_id,status)
  VALUES (v_brand,'website_setup',1,'one_per_brand',v_owner,NULL,'awaiting_owner')
  RETURNING id INTO v_brandwide;

  v_n := public.ari_flow_runs_expire_idle(v_owner);
  IF v_n <> 1 OR (SELECT status FROM public.ari_flow_runs WHERE id = v_marked) <> 'cancelled' THEN
    RAISE EXCEPTION 'expire_idle must close the deleted-chat run as cancelled, ended %', v_n;
  END IF;
  IF (SELECT status FROM public.ari_flow_runs WHERE id = v_brandwide) <> 'awaiting_owner' THEN
    RAISE EXCEPTION 'a fresh brand-wide run with no chat must stay open';
  END IF;
  IF public.ari_flow_runs_expire_idle(v_owner) <> 0 THEN
    RAISE EXCEPTION 'a second sweep must change nothing';
  END IF;

  -- Global sweep: the teammate's run in a chat deleted earlier.
  v_r := public.ari_flow_run_start(v_mate,v_brand,'create_event',2,'one_per_subject',v_chat3,NULL,'{}');
  v_marked := (v_r->'run'->>'id')::uuid;
  UPDATE public.ari_flow_runs SET conversation_deleted_at = now() WHERE id = v_marked;
  PERFORM public.ari_flow_runs_expire_idle_all(500);
  IF (SELECT status FROM public.ari_flow_runs WHERE id = v_marked) <> 'cancelled' THEN
    RAISE EXCEPTION 'expire_idle_all must close a deleted-chat run as cancelled';
  END IF;
  IF (SELECT status FROM public.ari_flow_runs WHERE id = v_brandwide) <> 'awaiting_owner' THEN
    RAISE EXCEPTION 'the global sweep must leave a fresh brand-wide run open';
  END IF;

  -- The idle rule still says expired (unchanged).
  UPDATE public.ari_flow_runs SET updated_at = now() - interval '3 days',
    created_at = now() - interval '3 days'
  WHERE id = v_brandwide;
  PERFORM public.ari_flow_runs_expire_idle_all(500);
  IF (SELECT status FROM public.ari_flow_runs WHERE id = v_brandwide) <> 'expired' THEN
    RAISE EXCEPTION 'an idle run must still expire (got %)',
      (SELECT status FROM public.ari_flow_runs WHERE id = v_brandwide);
  END IF;
END;
$i3355cd$;

ROLLBACK;

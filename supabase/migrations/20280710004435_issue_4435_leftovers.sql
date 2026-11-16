-- #4435 / #4436 last follow-up: group ownership on leave, unused group fields,
-- the accept call, and a short membership record for session notices.
--
--   L1. When the creator leaves a group that carries on, the creator's role
--       passes to the member who takes over (Seth's decision on #4435). One
--       rule picks that member (issue_4435_group_heir): the longest-standing
--       admin, else the longest-standing member, by join time, then row age,
--       then user id. The same rule already chose the admin when the last
--       admin left; it now has one owner. The new creator is an admin. A
--       creator who comes back later is an ordinary member. A group with no
--       accepted member left is still deleted, and 1:1 plans keep the #4114
--       rule.
--   L2. App clients can no longer change group fields the apps never write
--       (is_active, archived_at, participant_prefs, deck_version,
--       deck_params_hash). Server functions still do.
--   L3. accept_session_with_prefs needs a signed-in caller at the grant level
--       too (it already refused one inside).
--   L4. A short record of who left a group, kept for a day, which the server
--       reads to check session notices (service role only).
--
-- Invariants (declared in
-- supabase/migrations/__tests__/issue_4435_leftovers.implementor.pg17.test.sql):
--   I-4435-CREATOR-PASSES-ON-LEAVE, I-4435-ONE-HEIR-RULE,
--   I-4436-UNUSED-GROUP-FIELDS-SERVER-ONLY, I-4435-ACCEPT-SIGNED-IN-ONLY,
--   I-4435-SESSION-NOTICE-CHECK.
--
-- Replaced bodies are copied from their latest definitions and change only the
-- lines named here.

-- L1a. Who takes over a group (one owner of the rule).
CREATE OR REPLACE FUNCTION public.issue_4435_group_heir(p_session_id uuid, p_excluding uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT sp.user_id FROM public.session_participants sp
   WHERE sp.session_id = p_session_id AND sp.has_accepted = true
     AND sp.user_id IS DISTINCT FROM p_excluding
   ORDER BY (sp.is_admin IS TRUE) DESC, sp.joined_at ASC NULLS LAST, sp.created_at ASC, sp.user_id ASC
   LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.issue_4435_group_heir(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4435_group_heir(uuid, uuid) TO service_role;

-- L1b. Hand the creator's role to the heir. Does nothing unless p_leaving is
-- the creator and someone else is still an accepted member. Returns the heir.
-- Called by the leave trigger below and by delete-user (service role).
CREATE OR REPLACE FUNCTION public.issue_4435_hand_over_creator(p_session_id uuid, p_leaving uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_heir uuid; v_dm uuid;
BEGIN
  IF p_session_id IS NULL OR p_leaving IS NULL THEN RETURN NULL; END IF;
  SELECT cs.conversation_id INTO v_dm FROM public.collaboration_sessions cs
   WHERE cs.id = p_session_id AND cs.created_by = p_leaving;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_heir := public.issue_4435_group_heir(p_session_id, p_leaving);
  IF v_heir IS NULL THEN RETURN NULL; END IF;
  UPDATE public.collaboration_sessions SET created_by = v_heir
   WHERE id = p_session_id AND created_by = p_leaving;
  IF v_dm IS NULL THEN
    UPDATE public.session_participants SET is_admin = true
     WHERE session_id = p_session_id AND user_id = v_heir AND is_admin IS NOT TRUE;
  END IF;
  RETURN v_heir;
END $$;
REVOKE ALL ON FUNCTION public.issue_4435_hand_over_creator(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4435_hand_over_creator(uuid, uuid) TO service_role;

-- L1c. Leave trigger (copy of 20280708054435 A7). Changes: when the creator's
-- row goes and the group carries on, the creator's role passes on; the admin
-- handover uses the shared heir rule. Trigger name and binding unchanged.
CREATE OR REPLACE FUNCTION public.cleanup_session_if_under_two_participants()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_sid uuid := COALESCE(OLD.session_id, NEW.session_id);
  v_status text; v_dm uuid; v_creator uuid; v_accepted integer; v_heir uuid;
BEGIN
  IF v_sid IS NULL OR TG_OP = 'INSERT' THEN RETURN COALESCE(NEW, OLD); END IF;
  SELECT cs.status, cs.conversation_id, cs.created_by INTO v_status, v_dm, v_creator
    FROM public.collaboration_sessions cs WHERE cs.id = v_sid;
  IF NOT FOUND THEN RETURN COALESCE(NEW, OLD); END IF;     -- session already gone (cascade)
  SELECT count(*) INTO v_accepted FROM public.session_participants sp
   WHERE sp.session_id = v_sid AND sp.has_accepted = true;
  IF v_dm IS NOT NULL THEN                                  -- 1:1 collab (#4114): unchanged
    IF v_status = 'active' AND v_accepted < 2 THEN
      DELETE FROM public.collaboration_sessions WHERE id = v_sid;
    END IF;
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF v_accepted = 0 THEN
    DELETE FROM public.collaboration_sessions WHERE id = v_sid;
    RETURN COALESCE(NEW, OLD);
  END IF;
  -- #4435 follow-up: the creator left a group that carries on.
  IF TG_OP = 'DELETE' AND OLD.user_id = v_creator THEN
    v_heir := public.issue_4435_hand_over_creator(v_sid, OLD.user_id);
    IF v_heir IS NOT NULL THEN v_creator := v_heir; END IF;
  END IF;
  IF TG_OP = 'DELETE' AND NOT EXISTS (
       SELECT 1 FROM public.session_participants sp WHERE sp.session_id = v_sid
          AND sp.has_accepted = true AND (sp.is_admin IS TRUE OR sp.user_id = v_creator)) THEN
    v_heir := public.issue_4435_group_heir(v_sid, NULL);
    UPDATE public.session_participants SET is_admin = true
     WHERE session_id = v_sid AND user_id = v_heir;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

-- L2. Group guard (copy of 20280709004435 Q3c). One change: app clients
-- cannot change the fields no app writes; server functions are unaffected.
CREATE OR REPLACE FUNCTION public.tg_issue_4436_guard_group_write()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not signed in' USING ERRCODE = '42501';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'group ownership can only change through the server' USING ERRCODE = '42501';
  END IF;
  -- #4435 follow-up: fields only the server changes, for every app client.
  IF NEW.is_active IS DISTINCT FROM OLD.is_active OR NEW.archived_at IS DISTINCT FROM OLD.archived_at
     OR NEW.participant_prefs IS DISTINCT FROM OLD.participant_prefs
     OR NEW.deck_version IS DISTINCT FROM OLD.deck_version
     OR NEW.deck_params_hash IS DISTINCT FROM OLD.deck_params_hash THEN
    RAISE EXCEPTION 'these group fields can only change through the server' USING ERRCODE = '42501';
  END IF;
  IF OLD.created_by = v_uid
     AND (public.is_session_creator(OLD.id, v_uid) OR NOT public.issue_4435_has_accepted_member(OLD.id)) THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.session_participants sp
                  WHERE sp.session_id = OLD.id AND sp.user_id = v_uid AND sp.has_accepted IS TRUE) THEN
    RAISE EXCEPTION 'only accepted members can change the group' USING ERRCODE = '42501';
  END IF;
  IF NEW.invite_code IS DISTINCT FROM OLD.invite_code OR NEW.invite_link IS DISTINCT FROM OLD.invite_link
     OR NEW.max_participants IS DISTINCT FROM OLD.max_participants
     OR NEW.session_type IS DISTINCT FROM OLD.session_type THEN
    RAISE EXCEPTION 'only the group creator can change these group settings' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.tg_issue_4436_guard_group_write() FROM PUBLIC, anon, authenticated;

-- L3. The accept call is for signed-in people only.
REVOKE EXECUTE ON FUNCTION public.accept_session_with_prefs(
  uuid, uuid, numeric, numeric, text[], text[], text, integer, text, text, text[], boolean, text, boolean, boolean
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_session_with_prefs(
  uuid, uuid, numeric, numeric, text[], text[], text, integer, text, text, text[], boolean, text, boolean, boolean
) TO authenticated, service_role;

-- L4a. Who left a group recently (kept for a day). No app access.
CREATE TABLE IF NOT EXISTS public.issue_4435_member_departures (
  session_id uuid NOT NULL,
  user_id uuid NOT NULL,
  was_accepted boolean NOT NULL,
  departed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, user_id)
);
CREATE INDEX IF NOT EXISTS issue_4435_member_departures_departed_at
  ON public.issue_4435_member_departures (departed_at);
ALTER TABLE public.issue_4435_member_departures ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.issue_4435_member_departures FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.issue_4435_member_departures TO service_role;

CREATE OR REPLACE FUNCTION public.tg_issue_4435_record_departure()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO public.issue_4435_member_departures (session_id, user_id, was_accepted, departed_at)
  VALUES (OLD.session_id, OLD.user_id, COALESCE(OLD.has_accepted, false), now())
  ON CONFLICT (session_id, user_id) DO UPDATE
    SET was_accepted = EXCLUDED.was_accepted, departed_at = EXCLUDED.departed_at;
  DELETE FROM public.issue_4435_member_departures WHERE departed_at < now() - interval '1 day';
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION public.tg_issue_4435_record_departure() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS issue_4435_record_departure ON public.session_participants;
CREATE TRIGGER issue_4435_record_departure
  AFTER DELETE ON public.session_participants
  FOR EACH ROW WHEN (OLD.session_id IS NOT NULL AND OLD.user_id IS NOT NULL)
  EXECUTE FUNCTION public.tg_issue_4435_record_departure();

-- L4b. The check the server runs before a session notice an app asked for:
-- does the session still exist, is the sender an accepted member, and is the
-- recipient a member? "Member" includes someone who left in the last 10
-- minutes (a notice sent while a group is being deleted).
CREATE OR REPLACE FUNCTION public.issue_4435_session_notice_check(
  p_session_id uuid, p_sender uuid, p_recipient uuid
) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'session_exists', EXISTS (SELECT 1 FROM public.collaboration_sessions WHERE id = p_session_id),
    'sender_member',
      EXISTS (SELECT 1 FROM public.session_participants
               WHERE session_id = p_session_id AND user_id = p_sender AND has_accepted = true)
      OR EXISTS (SELECT 1 FROM public.issue_4435_member_departures
                  WHERE session_id = p_session_id AND user_id = p_sender AND was_accepted
                    AND departed_at > now() - interval '10 minutes'),
    'recipient_member',
      EXISTS (SELECT 1 FROM public.session_participants
               WHERE session_id = p_session_id AND user_id = p_recipient)
      OR EXISTS (SELECT 1 FROM public.issue_4435_member_departures
                  WHERE session_id = p_session_id AND user_id = p_recipient
                    AND departed_at > now() - interval '10 minutes')
  );
$$;
REVOKE ALL ON FUNCTION public.issue_4435_session_notice_check(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4435_session_notice_check(uuid, uuid, uuid) TO service_role;

-- #4436 follow-up: two server-checked tightenings on group membership writes.
--
-- 1. Deck preference writes are server-checked. upsert_participant_prefs
--    (SECURITY DEFINER, executable by authenticated) now writes only the
--    caller's own preferences when an app client calls it. Server roles
--    (service_role edge functions, postgres jobs) keep writing any accepted
--    member's preferences. Server functions that seed another member's
--    preferences call the internal writer issue_4436_write_participant_prefs,
--    which app clients cannot execute.
-- 2. A pending self-join needs an invitation. An app client may insert its
--    own pending member row only when it holds its own pending invitation for
--    that group (the creator's own row is unchanged). Every other #4436 rule
--    is unchanged.
--
-- Invariants (regression suite
-- supabase/migrations/__tests__/issue_4436_invited_self_join_and_own_prefs.implementor.pg17.test.sql):
-- I-4436-OWN-PREFS-ONLY and I-4436-INVITED-SELF-JOIN.
-- Every refusal raises SQLSTATE 42501 (PostgREST returns 403).

-- 1. Preferences --------------------------------------------------------------

-- The original upsert_participant_prefs body, unchanged, as an internal writer.
CREATE OR REPLACE FUNCTION public.issue_4436_write_participant_prefs(
  p_session_id uuid, p_user_id uuid, p_prefs jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
BEGIN
  -- Validate the target is an accepted participant
  IF NOT EXISTS (
    SELECT 1 FROM public.session_participants
    WHERE session_id = p_session_id AND user_id = p_user_id AND has_accepted = true
  ) THEN
    RAISE EXCEPTION 'Not a participant of this session';
  END IF;

  -- Deep merge: existing user prefs || new prefs (new keys win, old keys preserved)
  UPDATE public.collaboration_sessions
  SET participant_prefs = COALESCE(participant_prefs, '{}'::jsonb)
    || jsonb_build_object(
      p_user_id::text,
      COALESCE(participant_prefs -> p_user_id::text, '{}'::jsonb) || p_prefs
    ),
    updated_at = NOW()
  WHERE id = p_session_id;
END;
$$;
REVOKE ALL ON FUNCTION public.issue_4436_write_participant_prefs(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4436_write_participant_prefs(uuid, uuid, jsonb) TO service_role;

-- The client verb: an app client (SET ROLE authenticated or anon, which a
-- SECURITY DEFINER call does not change) writes only its own preferences.
CREATE OR REPLACE FUNCTION public.upsert_participant_prefs(p_session_id uuid, p_user_id uuid, p_prefs jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF COALESCE(current_setting('role', true), 'none') IN ('authenticated', 'anon')
     AND (v_uid IS NULL OR p_user_id IS DISTINCT FROM v_uid) THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;
  PERFORM public.issue_4436_write_participant_prefs(p_session_id, p_user_id, p_prefs);
END;
$$;
REVOKE ALL ON FUNCTION public.upsert_participant_prefs(uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_participant_prefs(uuid, uuid, jsonb) TO authenticated, service_role;

-- 2. Pending self-join needs an invitation ------------------------------------

-- Copy of the #4436 member guard (20280708044436) with one added rule in the
-- INSERT branch: a non-creator's own row needs their own pending invitation.
CREATE OR REPLACE FUNCTION public.tg_issue_4436_guard_member_write()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_session uuid := COALESCE(NEW.session_id, OLD.session_id);
  v_is_creator boolean;
  v_is_accepted boolean;
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;  -- server function or service role
  END IF;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not signed in' USING ERRCODE = '42501';
  END IF;
  v_is_creator := public.is_session_creator(v_session, v_uid);

  IF TG_OP = 'INSERT' THEN
    IF v_is_creator AND NEW.user_id = v_uid THEN
      RETURN NEW;  -- creator adds own row when creating the group
    END IF;
    IF NEW.is_admin IS TRUE OR NEW.has_accepted IS TRUE
       OR COALESCE(NEW.role, 'member') <> 'member' THEN
      RAISE EXCEPTION 'a new member starts as a pending, non-admin member' USING ERRCODE = '42501';
    END IF;
    IF NEW.user_id = v_uid AND NOT EXISTS (
         SELECT 1 FROM public.collaboration_invites ci
          WHERE ci.session_id = NEW.session_id AND ci.invited_user_id = v_uid
            AND ci.status = 'pending') THEN
      RAISE EXCEPTION 'joining a group needs an invitation' USING ERRCODE = '42501';
    END IF;
    IF NEW.user_id <> v_uid AND NOT v_is_creator THEN
      SELECT EXISTS (SELECT 1 FROM public.session_participants sp
                      WHERE sp.session_id = NEW.session_id AND sp.user_id = v_uid
                        AND sp.has_accepted IS TRUE) INTO v_is_accepted;
      IF NOT v_is_accepted THEN
        RAISE EXCEPTION 'only the group creator or an accepted member can invite' USING ERRCODE = '42501';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.session_id IS DISTINCT FROM OLD.session_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.has_accepted IS DISTINCT FROM OLD.has_accepted OR NEW.joined_at IS DISTINCT FROM OLD.joined_at THEN
    RAISE EXCEPTION 'membership fields can only change through the server' USING ERRCODE = '42501';
  END IF;
  IF (NEW.is_admin IS DISTINCT FROM OLD.is_admin OR NEW.role IS DISTINCT FROM OLD.role)
     AND NOT v_is_creator THEN
    RAISE EXCEPTION 'only the group creator can change admins' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.tg_issue_4436_guard_member_write() FROM PUBLIC, anon, authenticated;

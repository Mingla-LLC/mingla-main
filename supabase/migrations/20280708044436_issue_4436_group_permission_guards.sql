-- #4436: guard who can change group membership and group settings.
--
-- Invariant (enforced by the two triggers below; regression suite
-- supabase/migrations/__tests__/issue_4436_group_permission_guards.implementor.pg17.test.sql,
-- invariant I-4436-GROUP-WRITE-GUARD): app clients (the authenticated and anon
-- roles) never change admin status, acceptance or ownership of a group or its
-- member rows. Only server functions that check the caller (SECURITY DEFINER,
-- owner postgres) and service_role edge functions do, and those run as a
-- non-client role, so these guards let them through unchanged.
--
-- Client writes keep the fields a client legitimately changes: the creator
-- adds their own accepted row and invites people as pending members; an
-- accepted member invites people as pending members; a member mutes their own
-- notifications; the creator changes admins and creator-only settings; an
-- accepted member changes the group's name, status and activity time.
-- Every refusal raises SQLSTATE 42501 (PostgREST returns 403).
-- No policy, grant or function outside these two triggers is changed.

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

DROP TRIGGER IF EXISTS issue_4436_guard_member_write ON public.session_participants;
CREATE TRIGGER issue_4436_guard_member_write
  BEFORE INSERT OR UPDATE ON public.session_participants
  FOR EACH ROW EXECUTE FUNCTION public.tg_issue_4436_guard_member_write();

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
  IF OLD.created_by = v_uid THEN
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

DROP TRIGGER IF EXISTS issue_4436_guard_group_write ON public.collaboration_sessions;
CREATE TRIGGER issue_4436_guard_group_write
  BEFORE UPDATE ON public.collaboration_sessions
  FOR EACH ROW EXECUTE FUNCTION public.tg_issue_4436_guard_group_write();

REVOKE ALL ON FUNCTION public.tg_issue_4436_guard_member_write() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_issue_4436_guard_group_write() FROM PUBLIC, anon, authenticated;

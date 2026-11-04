-- Issue #4261 Wave F — accepting a friend request now credits the referral.
--
-- credit_referral_on_friend_accepted (only definition until now: the
-- 20260505000000 baseline squash) had two defects:
--
-- 1. It tested `credit IS NOT NULL` on a RECORD. A record IS NOT NULL only
--    when every field is non-null, and a pending referral_credits row always
--    has NULL credited_at / friend_request_id (and usually pending_invite_id),
--    so no pending credit was ever credited. Each SELECT ... INTO is now
--    followed by IF FOUND.
-- 2. Its pending-session loops inserted collaboration_invites.invitee_id, a
--    column that does not exist (it is invited_user_id), so a friend-request
--    accept aborted whenever a matching pending_session_invites row existed.
--    The insert now names invited_user_id with
--    ON CONFLICT (session_id, invited_user_id) DO NOTHING
--    (collaboration_invites_session_invited_user_unique).
--
-- Also pins search_path (SECURITY DEFINER). Bonus-month maths and session
-- conversion are unchanged. The trigger (trg_credit_referral_on_friend_accepted
-- AFTER UPDATE ON friend_requests) is unchanged; CREATE OR REPLACE keeps the
-- owner and grants. No backfill of older pending credits (decision O-3).
-- Static SQL, idempotent.

BEGIN;

CREATE OR REPLACE FUNCTION "public"."credit_referral_on_friend_accepted"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  credit RECORD;
  pending_session RECORD;
BEGIN
  IF NEW.status = 'accepted' AND OLD.status = 'pending' THEN
    -- Check for pending referral credit (sender referred receiver)
    SELECT * INTO credit FROM public.referral_credits
    WHERE referrer_id = NEW.sender_id AND referred_id = NEW.receiver_id AND status = 'pending';

    IF FOUND THEN
      UPDATE public.referral_credits
      SET status = 'credited', credited_at = NOW(), friend_request_id = NEW.id
      WHERE id = credit.id;

      UPDATE public.subscriptions
      SET referral_bonus_months = referral_bonus_months + 1,
          -- Start the clock on first referral, or restart if previous bonus fully expired
          referral_bonus_started_at = CASE
            WHEN referral_bonus_started_at IS NULL THEN NOW()
            WHEN referral_bonus_started_at + (referral_bonus_months * INTERVAL '30 days') <= NOW()
              THEN NOW()
            ELSE referral_bonus_started_at
          END,
          updated_at = NOW()
      WHERE user_id = credit.referrer_id;
    END IF;

    -- Also check reverse direction (receiver referred sender)
    SELECT * INTO credit FROM public.referral_credits
    WHERE referrer_id = NEW.receiver_id AND referred_id = NEW.sender_id AND status = 'pending';

    IF FOUND THEN
      UPDATE public.referral_credits
      SET status = 'credited', credited_at = NOW(), friend_request_id = NEW.id
      WHERE id = credit.id;

      UPDATE public.subscriptions
      SET referral_bonus_months = referral_bonus_months + 1,
          -- Start the clock on first referral, or restart if previous bonus fully expired
          referral_bonus_started_at = CASE
            WHEN referral_bonus_started_at IS NULL THEN NOW()
            WHEN referral_bonus_started_at + (referral_bonus_months * INTERVAL '30 days') <= NOW()
              THEN NOW()
            ELSE referral_bonus_started_at
          END,
          updated_at = NOW()
      WHERE user_id = credit.referrer_id;
    END IF;

    -- Convert pending_session_invites for the newly friended pair
    -- Direction 1: sender invited receiver's phone
    FOR pending_session IN
      SELECT psi.* FROM public.pending_session_invites psi
      JOIN public.pending_invites pi ON pi.inviter_id = psi.inviter_id AND pi.phone_e164 = psi.phone_e164
      WHERE psi.inviter_id = NEW.sender_id
        AND pi.converted_user_id = NEW.receiver_id
        AND psi.status = 'pending'
    LOOP
      INSERT INTO public.collaboration_invites (session_id, inviter_id, invited_user_id, status, invite_method)
      VALUES (pending_session.session_id, pending_session.inviter_id, NEW.receiver_id, 'pending', 'friends_list')
      ON CONFLICT (session_id, invited_user_id) DO NOTHING;

      INSERT INTO public.session_participants (session_id, user_id, has_accepted)
      VALUES (pending_session.session_id, NEW.receiver_id, false)
      ON CONFLICT (session_id, user_id) DO NOTHING;

      UPDATE public.pending_session_invites
      SET status = 'converted', updated_at = NOW()
      WHERE id = pending_session.id;
    END LOOP;

    -- Direction 2: receiver invited sender's phone
    FOR pending_session IN
      SELECT psi.* FROM public.pending_session_invites psi
      JOIN public.pending_invites pi ON pi.inviter_id = psi.inviter_id AND pi.phone_e164 = psi.phone_e164
      WHERE psi.inviter_id = NEW.receiver_id
        AND pi.converted_user_id = NEW.sender_id
        AND psi.status = 'pending'
    LOOP
      INSERT INTO public.collaboration_invites (session_id, inviter_id, invited_user_id, status, invite_method)
      VALUES (pending_session.session_id, pending_session.inviter_id, NEW.sender_id, 'pending', 'friends_list')
      ON CONFLICT (session_id, invited_user_id) DO NOTHING;

      INSERT INTO public.session_participants (session_id, user_id, has_accepted)
      VALUES (pending_session.session_id, NEW.sender_id, false)
      ON CONFLICT (session_id, user_id) DO NOTHING;

      UPDATE public.pending_session_invites
      SET status = 'converted', updated_at = NOW()
      WHERE id = pending_session.id;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."credit_referral_on_friend_accepted"() OWNER TO "postgres";

COMMENT ON FUNCTION "public"."credit_referral_on_friend_accepted"() IS
  'Issue #4261: on friend_requests pending -> accepted, credits a pending referral (either direction, IF FOUND) and converts matching pending_session_invites into collaboration_invites (invited_user_id).';

COMMIT;

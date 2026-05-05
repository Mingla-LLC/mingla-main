-- Migration: fix_pending_invite_trigger_no_auto_accept
-- Description: Stop auto-accepting friend links and friend requests when an
-- invited user verifies their phone. Create both as 'pending' so the new user
-- sees them at onboarding Step 5 and can explicitly accept or decline.
-- The saved_people creation is deferred to the explicit accept path
-- (respond-friend-link edge function), which already handles it.

CREATE OR REPLACE FUNCTION public.convert_pending_invites_on_phone_verified()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  pending RECORD;
BEGIN
  IF NEW.phone IS NOT NULL AND (OLD.phone IS NULL OR OLD.phone != NEW.phone) THEN

    FOR pending IN
      SELECT * FROM public.pending_invites
      WHERE phone_e164 = NEW.phone AND status = 'pending'
    LOOP

      -- 1. Create legacy friend_requests row as PENDING (so it shows in onboarding)
      INSERT INTO public.friend_requests (sender_id, receiver_id, status)
      VALUES (pending.inviter_id, NEW.id, 'pending')
      ON CONFLICT (sender_id, receiver_id) DO NOTHING;

      -- 2. Create friend_links row as PENDING (so it shows in onboarding)
      INSERT INTO public.friend_links (
        requester_id, target_id, status
      ) VALUES (
        pending.inviter_id, NEW.id, 'pending'
      )
      ON CONFLICT DO NOTHING;

      -- 3. Mark pending_invite as converted
      UPDATE public.pending_invites
      SET status = 'converted', converted_user_id = NEW.id, converted_at = NOW()
      WHERE id = pending.id;

      -- 4. Referral credit (existing behavior — still created on signup)
      INSERT INTO public.referral_credits (referrer_id, referred_id, pending_invite_id, status)
      VALUES (pending.inviter_id, NEW.id, pending.id, 'pending')
      ON CONFLICT (referrer_id, referred_id) DO NOTHING;

    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

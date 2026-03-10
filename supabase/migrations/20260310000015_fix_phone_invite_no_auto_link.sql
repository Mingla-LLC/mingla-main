-- Migration: 20260310000015_fix_phone_invite_no_auto_link.sql
-- Description: Phone invite auto-link now creates basic friendship only,
-- not automatic profile linkage. Both users must consent to linking separately.

CREATE OR REPLACE FUNCTION public.convert_pending_invites_on_phone_verified()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  pending RECORD;
  new_link_id UUID;
BEGIN
  -- Only fire when phone changes from NULL to a value
  IF NEW.phone IS NULL OR (OLD.phone IS NOT NULL AND OLD.phone = NEW.phone) THEN
    RETURN NEW;
  END IF;

  FOR pending IN
    SELECT * FROM public.pending_invites
    WHERE phone_e164 = NEW.phone
      AND status = 'pending'
      AND inviter_id != NEW.id
  LOOP
    -- 1. Legacy friend_requests (existing behavior, kept for referral triggers)
    INSERT INTO public.friend_requests (sender_id, receiver_id, status)
    VALUES (pending.inviter_id, NEW.id, 'pending')
    ON CONFLICT (sender_id, receiver_id) DO NOTHING;

    -- 2. Create friend_links row: accepted friendship, pending link consent
    INSERT INTO public.friend_links (
      requester_id, target_id, status, accepted_at,
      link_status, requester_link_consent, target_link_consent
    )
    VALUES (
      pending.inviter_id, NEW.id, 'accepted', NOW(),
      'pending_consent', FALSE, FALSE
    )
    ON CONFLICT DO NOTHING
    RETURNING id INTO new_link_id;

    -- Only proceed if link was actually created (not a duplicate)
    IF new_link_id IS NOT NULL THEN
      -- 3. Create bidirectional friends rows (basic friendship)
      INSERT INTO public.friends (user_id, friend_user_id, status)
      VALUES (pending.inviter_id, NEW.id, 'accepted')
      ON CONFLICT (user_id, friend_user_id) DO NOTHING;

      INSERT INTO public.friends (user_id, friend_user_id, status)
      VALUES (NEW.id, pending.inviter_id, 'accepted')
      ON CONFLICT (user_id, friend_user_id) DO NOTHING;

      -- 4. Mirror accept to friend_requests for referral credit trigger
      UPDATE public.friend_requests
      SET status = 'accepted', updated_at = NOW()
      WHERE sender_id = pending.inviter_id
        AND receiver_id = NEW.id
        AND status = 'pending';
    END IF;

    -- 5. Mark pending_invite as converted
    UPDATE public.pending_invites
    SET status = 'converted', converted_user_id = NEW.id, converted_at = NOW()
    WHERE id = pending.id;

    -- 6. Referral credit (existing behavior)
    INSERT INTO public.referral_credits (referrer_id, referred_id, pending_invite_id, status)
    VALUES (pending.inviter_id, NEW.id, pending.id, 'pending')
    ON CONFLICT (referrer_id, referred_id) DO NOTHING;

  END LOOP;

  RETURN NEW;
END;
$$;

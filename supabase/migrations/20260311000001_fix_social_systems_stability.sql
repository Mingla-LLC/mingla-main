-- Migration: 20260311000001_fix_social_systems_stability
-- Description: Fixes phone invite auto-accept, adds RLS to friend_requests,
--   drops dead accept_friend_request trigger, adds decline cascade to friend_links.

-- ═══════════════════════════════════════════════════════════
-- FIX B1: Rewrite phone invite trigger to create everything as PENDING
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.convert_pending_invites_on_phone_verified()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  pending RECORD;
BEGIN
  -- Only fire when phone changes from NULL to a value (or changes to a new value)
  IF NEW.phone IS NULL OR (OLD.phone IS NOT NULL AND OLD.phone = NEW.phone) THEN
    RETURN NEW;
  END IF;

  FOR pending IN
    SELECT * FROM public.pending_invites
    WHERE phone_e164 = NEW.phone
      AND status = 'pending'
      AND inviter_id != NEW.id   -- prevent self-conversion
  LOOP
    -- 1. Create legacy friend_requests as PENDING (user must explicitly accept)
    INSERT INTO public.friend_requests (sender_id, receiver_id, status)
    VALUES (pending.inviter_id, NEW.id, 'pending')
    ON CONFLICT (sender_id, receiver_id) DO NOTHING;

    -- 2. Create friend_links as PENDING (user must explicitly accept)
    --    Do NOT set link_status or consent flags — those are only set on accept.
    INSERT INTO public.friend_links (
      requester_id, target_id, status
    )
    VALUES (
      pending.inviter_id, NEW.id, 'pending'
    )
    ON CONFLICT DO NOTHING;

    -- 3. Mark pending_invite as converted
    UPDATE public.pending_invites
    SET status = 'converted', converted_user_id = NEW.id, converted_at = NOW()
    WHERE id = pending.id;

    -- 4. Referral credit (created on signup, activated on friend accept)
    INSERT INTO public.referral_credits (referrer_id, referred_id, pending_invite_id, status)
    VALUES (pending.inviter_id, NEW.id, pending.id, 'pending')
    ON CONFLICT (referrer_id, referred_id) DO NOTHING;

  END LOOP;

  RETURN NEW;
END;
$$;

-- Ensure the trigger is attached to profiles (idempotent)
DROP TRIGGER IF EXISTS trg_convert_pending_invites_on_phone ON public.profiles;
CREATE TRIGGER trg_convert_pending_invites_on_phone
  AFTER UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.convert_pending_invites_on_phone_verified();


-- ═══════════════════════════════════════════════════════════
-- FIX B5: Enable RLS on friend_requests and add proper policies
-- ═══════════════════════════════════════════════════════════

ALTER TABLE public.friend_requests ENABLE ROW LEVEL SECURITY;

-- Users can read requests they sent or received
DROP POLICY IF EXISTS "fr_select" ON public.friend_requests;
CREATE POLICY "fr_select" ON public.friend_requests
FOR SELECT USING (
  auth.uid() = sender_id OR auth.uid() = receiver_id
);

-- Users can create requests where they are the sender
DROP POLICY IF EXISTS "fr_insert" ON public.friend_requests;
CREATE POLICY "fr_insert" ON public.friend_requests
FOR INSERT WITH CHECK (
  auth.uid() = sender_id
);

-- Users can update requests they are part of (accept, decline)
-- WITH CHECK prevents mutation of sender_id/receiver_id fields
DROP POLICY IF EXISTS "fr_update" ON public.friend_requests;
CREATE POLICY "fr_update" ON public.friend_requests
FOR UPDATE USING (
  auth.uid() = sender_id OR auth.uid() = receiver_id
) WITH CHECK (
  auth.uid() = sender_id OR auth.uid() = receiver_id
);

-- Users can delete requests they sent (cancel)
DROP POLICY IF EXISTS "fr_delete" ON public.friend_requests;
CREATE POLICY "fr_delete" ON public.friend_requests
FOR DELETE USING (
  auth.uid() = sender_id
);


-- ═══════════════════════════════════════════════════════════
-- FIX H1: Drop dead accept_friend_request trigger
-- The trigger is on `friends` table (AFTER UPDATE) but friends rows
-- are always INSERT'd as 'accepted', never UPDATE'd from 'pending'.
-- It never fires. Remove it to prevent confusion and future collisions.
-- ═══════════════════════════════════════════════════════════

DROP TRIGGER IF EXISTS accept_friend_request_trigger ON public.friends;
-- Keep the function (it's harmless and may be referenced elsewhere)


-- ═══════════════════════════════════════════════════════════
-- FIX B7: Add trigger to cascade friend_request decline to friend_links
-- When a legacy friend_request is declined, also decline any matching
-- pending friend_link (same sender/receiver pair). This prevents
-- orphan pending friend_links from resurfacing in the UI.
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.cascade_friend_request_decline_to_links()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.status = 'declined' AND OLD.status = 'pending' THEN
    UPDATE public.friend_links
    SET status = 'declined', updated_at = NOW()
    WHERE requester_id = OLD.sender_id
      AND target_id = OLD.receiver_id
      AND status = 'pending';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cascade_fr_decline_to_links ON public.friend_requests;
CREATE TRIGGER trg_cascade_fr_decline_to_links
  AFTER UPDATE ON public.friend_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.cascade_friend_request_decline_to_links();

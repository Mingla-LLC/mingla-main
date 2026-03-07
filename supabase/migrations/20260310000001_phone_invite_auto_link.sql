-- Migration: 20260310000001_phone_invite_auto_link.sql
-- Description: Upgrades the pending invite auto-convert trigger to also create
-- friend_links (accepted) and saved_people entries when an invited user signs up.

CREATE OR REPLACE FUNCTION public.convert_pending_invites_on_phone_verified()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  pending RECORD;
  new_link_id UUID;
  inviter_profile RECORD;
  new_user_profile RECORD;
  inviter_initials TEXT;
  new_user_initials TEXT;
  inviter_person_id UUID;
  new_user_person_id UUID;
  existing_person RECORD;
BEGIN
  IF NEW.phone IS NOT NULL AND (OLD.phone IS NULL OR OLD.phone != NEW.phone) THEN

    -- Cache the new user's profile data once
    SELECT display_name, username, birthday, gender, avatar_url
    INTO new_user_profile
    FROM public.profiles WHERE id = NEW.id;

    -- Compute initials for new user
    new_user_initials := UPPER(LEFT(COALESCE(new_user_profile.display_name, new_user_profile.username, '??'), 2));

    FOR pending IN
      SELECT * FROM public.pending_invites
      WHERE phone_e164 = NEW.phone AND status = 'pending'
    LOOP

      -- 1. Legacy friend_requests (existing behavior, kept for referral triggers)
      INSERT INTO public.friend_requests (sender_id, receiver_id, status)
      VALUES (pending.inviter_id, NEW.id, 'pending')
      ON CONFLICT (sender_id, receiver_id) DO NOTHING;

      -- 2. Create friend_links row with status 'accepted'
      INSERT INTO public.friend_links (
        requester_id, target_id, status, accepted_at
      ) VALUES (
        pending.inviter_id, NEW.id, 'accepted', NOW()
      )
      ON CONFLICT DO NOTHING  -- respects idx_friend_links_active_pair unique index
      RETURNING id INTO new_link_id;

      -- Only create saved_people if the friend_link was actually inserted
      IF new_link_id IS NOT NULL THEN

        -- Cache inviter profile
        SELECT display_name, username, birthday, gender, avatar_url
        INTO inviter_profile
        FROM public.profiles WHERE id = pending.inviter_id;

        inviter_initials := UPPER(LEFT(COALESCE(inviter_profile.display_name, inviter_profile.username, '??'), 2));

        -- 3a. saved_people entry for new user on INVITER's side
        SELECT id INTO existing_person
        FROM public.saved_people
        WHERE user_id = pending.inviter_id AND linked_user_id = NEW.id
        LIMIT 1;

        IF existing_person IS NOT NULL THEN
          UPDATE public.saved_people SET
            is_linked = TRUE, link_id = new_link_id,
            name = COALESCE(new_user_profile.display_name, new_user_profile.username, 'Linked Friend'),
            initials = new_user_initials,
            birthday = new_user_profile.birthday,
            gender = new_user_profile.gender,
            updated_at = NOW()
          WHERE id = existing_person.id;
          inviter_person_id := existing_person.id;
        ELSE
          INSERT INTO public.saved_people (
            user_id, name, initials, birthday, gender,
            is_linked, linked_user_id, link_id
          ) VALUES (
            pending.inviter_id,
            COALESCE(new_user_profile.display_name, new_user_profile.username, 'Linked Friend'),
            new_user_initials,
            new_user_profile.birthday,
            new_user_profile.gender,
            TRUE, NEW.id, new_link_id
          ) RETURNING id INTO inviter_person_id;
        END IF;

        -- 3b. saved_people entry for inviter on NEW USER's side
        SELECT id INTO existing_person
        FROM public.saved_people
        WHERE user_id = NEW.id AND linked_user_id = pending.inviter_id
        LIMIT 1;

        IF existing_person IS NOT NULL THEN
          UPDATE public.saved_people SET
            is_linked = TRUE, link_id = new_link_id,
            name = COALESCE(inviter_profile.display_name, inviter_profile.username, 'Linked Friend'),
            initials = inviter_initials,
            birthday = inviter_profile.birthday,
            gender = inviter_profile.gender,
            updated_at = NOW()
          WHERE id = existing_person.id;
          new_user_person_id := existing_person.id;
        ELSE
          INSERT INTO public.saved_people (
            user_id, name, initials, birthday, gender,
            is_linked, linked_user_id, link_id
          ) VALUES (
            NEW.id,
            COALESCE(inviter_profile.display_name, inviter_profile.username, 'Linked Friend'),
            inviter_initials,
            inviter_profile.birthday,
            inviter_profile.gender,
            TRUE, pending.inviter_id, new_link_id
          ) RETURNING id INTO new_user_person_id;
        END IF;

        -- 4. Update friend_links with person IDs
        UPDATE public.friend_links SET
          requester_person_id = inviter_person_id,
          target_person_id = new_user_person_id,
          updated_at = NOW()
        WHERE id = new_link_id;

        -- 5. Mirror accept to friend_requests for referral credit trigger
        UPDATE public.friend_requests SET status = 'accepted'
        WHERE sender_id = pending.inviter_id
          AND receiver_id = NEW.id
          AND status = 'pending';

      END IF;

      -- 6. Mark pending_invite as converted
      UPDATE public.pending_invites
      SET status = 'converted', converted_user_id = NEW.id, converted_at = NOW()
      WHERE id = pending.id;

      -- 7. Referral credit (existing behavior)
      INSERT INTO public.referral_credits (referrer_id, referred_id, pending_invite_id, status)
      VALUES (pending.inviter_id, NEW.id, pending.id, 'pending')
      ON CONFLICT (referrer_id, referred_id) DO NOTHING;

    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

-- Migration: fix_pair_invite_trigger_on_conflict
-- Description: Fixes convert_pending_pair_invites_on_phone_verified() which crashes
-- with SQLSTATE 42P10 ("there is no unique or exclusion constraint matching the
-- ON CONFLICT specification") when a pending_pair_invite exists for the phone being verified.
--
-- Root cause: Migration 20260314000007 replaced the full unique constraint
--   pair_requests_unique_pending UNIQUE (sender_id, receiver_id)
-- with a partial unique index:
--   idx_pair_requests_unique_active UNIQUE (sender_id, receiver_id) WHERE status IN ('pending','accepted')
--
-- But the trigger function (from 20260314000002) still uses:
--   ON CONFLICT (sender_id, receiver_id) DO NOTHING
-- PostgreSQL cannot match a bare ON CONFLICT against a partial unique index.
--
-- This crashes the trigger, which rolls back the entire profiles.phone UPDATE,
-- producing: "Phone verified but save failed. Contact support."
--
-- Fix: Replace ON CONFLICT with a plain INSERT wrapped in
-- BEGIN...EXCEPTION WHEN unique_violation THEN NULL; END;
-- This is the only safe approach when the uniqueness constraint is partial —
-- ON CONFLICT cannot reference partial indexes, and NOT EXISTS has a TOCTOU
-- race under concurrent transactions. The EXCEPTION block catches 23505 at
-- the storage engine level, restoring the atomic silent-skip behavior of
-- the old ON CONFLICT DO NOTHING.

CREATE OR REPLACE FUNCTION convert_pending_pair_invites_on_phone_verified()
RETURNS TRIGGER AS $$
DECLARE
    v_invite RECORD;
    v_friend_request_id UUID;
BEGIN
    IF NEW.phone IS NOT NULL AND (OLD.phone IS NULL OR OLD.phone != NEW.phone) THEN
        FOR v_invite IN
            SELECT * FROM pending_pair_invites
            WHERE phone_e164 = NEW.phone AND status = 'pending'
        LOOP
            -- Step 1: Create friend request (if not already exists)
            INSERT INTO friend_requests (sender_id, receiver_id, status)
            VALUES (v_invite.inviter_id, NEW.id, 'pending')
            ON CONFLICT (sender_id, receiver_id) DO NOTHING
            RETURNING id INTO v_friend_request_id;

            -- If friend request already existed, look it up
            IF v_friend_request_id IS NULL THEN
                SELECT id INTO v_friend_request_id
                FROM friend_requests
                WHERE sender_id = v_invite.inviter_id AND receiver_id = NEW.id;
            END IF;

            -- Step 2: Create pair request, hidden until friend request is accepted.
            -- Plain INSERT wrapped in EXCEPTION because the unique constraint is a
            -- partial index (idx_pair_requests_unique_active) which ON CONFLICT
            -- cannot reference. The EXCEPTION block gives us atomic duplicate-safety.
            BEGIN
                INSERT INTO pair_requests (
                    sender_id, receiver_id, status, visibility,
                    gated_by_friend_request_id, pending_display_name, pending_phone_e164
                )
                VALUES (
                    v_invite.inviter_id, NEW.id, 'pending', 'hidden_until_friend',
                    v_friend_request_id, NULL, v_invite.phone_e164
                );
            EXCEPTION WHEN unique_violation THEN
                NULL;  -- already exists — silent skip, same as ON CONFLICT DO NOTHING
            END;

            -- Step 3: Mark invite as converted
            UPDATE pending_pair_invites
            SET status = 'converted', converted_user_id = NEW.id, converted_at = now()
            WHERE id = v_invite.id;
        END LOOP;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- Fix: Profile deletion chain — 3 structural bugs
-- ============================================================================
--
-- Bug 1: create_preference_history trigger crashes on DELETE
--   Deployed trigger uses NEW.profile_id on DELETE (NEW is NULL on DELETE).
--   preference_history.user_id is NOT NULL → INSERT fails → transaction aborts.
--   Fix: Skip history recording on DELETE operations entirely.
--
-- Bug 2: profiles.id has no FK to auth.users(id)
--   When auth.admin.deleteUser() runs, there's no CASCADE to profiles.
--   The edge function's manual delete fails because of Bug 1, leaving orphans.
--   Fix: Add FK with ON DELETE CASCADE so profiles auto-delete with auth users.
--
-- Bug 3: Orphan profiles block re-registration
--   Any profile whose auth user was deleted but profile survived (due to Bug 1)
--   blocks re-registration via profiles_email_unique constraint.
--   Fix: Delete all orphan profiles before adding the FK.
-- ============================================================================

-- ── Fix 1: Rewrite trigger to skip DELETE ─────────────────────────────────

CREATE OR REPLACE FUNCTION public.create_preference_history()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;

    INSERT INTO public.preference_history (
        user_id,
        preference_id,
        old_data,
        new_data,
        change_type
    ) VALUES (
        NEW.profile_id,
        NEW.profile_id,
        CASE
            WHEN TG_OP = 'INSERT' THEN '{}'::jsonb
            ELSE to_jsonb(OLD)
        END,
        to_jsonb(NEW),
        TG_OP
    );
    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'preference_history insert failed: %', SQLERRM;
    RETURN NEW;
END;
$$;

-- ── Fix 2: Clean up ALL orphan profiles (no auth user) BEFORE adding FK ──

DELETE FROM public.preference_history
WHERE user_id IN (
    SELECT p.id FROM public.profiles p
    LEFT JOIN auth.users u ON u.id = p.id
    WHERE u.id IS NULL
);

DELETE FROM public.preferences
WHERE profile_id IN (
    SELECT p.id FROM public.profiles p
    LEFT JOIN auth.users u ON u.id = p.id
    WHERE u.id IS NULL
);

DELETE FROM public.profiles
WHERE id IN (
    SELECT p.id FROM public.profiles p
    LEFT JOIN auth.users u ON u.id = p.id
    WHERE u.id IS NULL
);

-- ── Fix 3: Add FK from profiles.id → auth.users(id) ON DELETE CASCADE ────

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'profiles_id_fkey_auth_users'
    ) THEN
        ALTER TABLE public.profiles
            ADD CONSTRAINT profiles_id_fkey_auth_users
            FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
    END IF;
END $$;

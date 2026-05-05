-- ============================================
-- Deduplicate profiles by email
-- ============================================
-- Step 1: Delete ghost profiles (never finished onboarding, no phone).
-- Step 2: For emails that STILL have duplicates after Step 1, keep only the
--         "best" profile per email: prefer the one with a phone number,
--         otherwise keep the most recently created one. Delete the rest.
--         Admin and QA accounts are never deleted.
-- Step 3: Add a UNIQUE constraint on email (NULLs exempt) to prevent
--         future duplicates.
-- ============================================

-- Disable preference history trigger to prevent NOT NULL violations
-- during cascade deletes (some preferences rows have NULL profile_id)
ALTER TABLE public.preferences DISABLE TRIGGER trigger_preference_history;

-- Step 1: Remove obvious ghosts (incomplete onboarding + no phone)
DELETE FROM public.profiles
WHERE has_completed_onboarding = false
  AND phone IS NULL
  AND (account_type IS NULL OR account_type NOT IN ('admin', 'qa_manager'));

-- Step 2: Deduplicate remaining profiles that share an email.
-- For each email, keep the "best" row: phone NOT NULL wins, then latest created_at.
-- Everything else gets deleted.
DELETE FROM public.profiles
WHERE email IS NOT NULL
  AND (account_type IS NULL OR account_type NOT IN ('admin', 'qa_manager'))
  AND id NOT IN (
    SELECT DISTINCT ON (email) id
    FROM public.profiles
    WHERE email IS NOT NULL
    ORDER BY email,
             (phone IS NOT NULL) DESC,  -- prefer profile with verified phone
             created_at DESC             -- then most recent
  );

-- Re-enable preference history trigger
ALTER TABLE public.preferences ENABLE TRIGGER trigger_preference_history;

-- Step 3: Add unique constraint on email (NULLs are exempt by default in Postgres)
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_email_unique UNIQUE (email);

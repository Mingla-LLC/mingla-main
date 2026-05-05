-- FIX: handle_new_user() username collision crash
-- Root cause: ON CONFLICT (id) DO NOTHING only catches PK conflicts, not
-- profiles_username_key UNIQUE violations. When two users derive the same
-- username from their email prefix (e.g. john@gmail.com and john@icloud.com),
-- the second INSERT crashes the trigger and rolls back the entire auth.users
-- INSERT, producing "Database error saving new user."
--
-- Fix: Wrap the INSERT in a LOOP with EXCEPTION WHEN unique_violation that
-- appends a random 4-char suffix and retries up to 5 times. After 5 failures,
-- falls back to a UUID-based username that is guaranteed unique.
--
-- Also fixes HF-001: the bare 'user' fallback (when email and phone are both
-- NULL) now includes a UUID prefix to prevent guaranteed collision on the
-- second user hitting that path.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  user_email TEXT;
  user_phone TEXT;
  default_display_name TEXT;
  default_username TEXT;
  base_username TEXT;
  default_first_name TEXT;
  user_account_type TEXT;
  username_suffix TEXT;
  retry_count INTEGER := 0;
  violation_constraint TEXT;
BEGIN
  -- Auto-confirm the user's email/phone to bypass confirmation requirement
  UPDATE auth.users
  SET email_confirmed_at = COALESCE(email_confirmed_at, now()),
      phone_confirmed_at = COALESCE(phone_confirmed_at, now())
  WHERE id = NEW.id;

  -- Get email or phone
  user_email := NEW.email;
  user_phone := NEW.phone;

  -- Get account_type from metadata if provided
  user_account_type := NEW.raw_user_meta_data->>'account_type';

  -- Determine default username
  -- Priority: metadata > email > phone > UUID-based fallback
  IF NEW.raw_user_meta_data->>'username' IS NOT NULL THEN
    default_username := NEW.raw_user_meta_data->>'username';
  ELSIF user_email IS NOT NULL THEN
    default_username := SPLIT_PART(user_email, '@', 1);
  ELSIF user_phone IS NOT NULL THEN
    default_username := 'user' || RIGHT(REGEXP_REPLACE(user_phone, '[^0-9]', '', 'g'), 6);
  ELSE
    default_username := 'user_' || LEFT(NEW.id::text, 8);
  END IF;

  -- Keep the base for retry suffix generation
  base_username := default_username;

  -- Determine default display name
  IF NEW.raw_user_meta_data->>'display_name' IS NOT NULL THEN
    default_display_name := NEW.raw_user_meta_data->>'display_name';
  ELSIF user_email IS NOT NULL THEN
    default_display_name := user_email;
  ELSIF user_phone IS NOT NULL THEN
    default_display_name := user_phone;
  ELSE
    default_display_name := 'User';
  END IF;

  -- Determine default first name
  IF NEW.raw_user_meta_data->>'first_name' IS NOT NULL THEN
    default_first_name := NEW.raw_user_meta_data->>'first_name';
  ELSIF user_email IS NOT NULL THEN
    default_first_name := SPLIT_PART(user_email, '@', 1);
  ELSE
    default_first_name := default_username;
  END IF;

  -- Insert profile with collision-safe username (retry loop)
  LOOP
    BEGIN
      INSERT INTO public.profiles (
        id, email, phone, display_name, username, first_name, last_name,
        account_type, has_completed_onboarding, created_at, updated_at
      ) VALUES (
        NEW.id,
        user_email,
        user_phone,
        default_display_name,
        default_username,
        default_first_name,
        COALESCE(NEW.raw_user_meta_data->>'last_name', ''),
        user_account_type,
        false,
        now(),
        now()
      )
      ON CONFLICT (id) DO NOTHING;

      -- Success — exit the retry loop
      EXIT;

    EXCEPTION WHEN unique_violation THEN
      -- Only retry on username collisions; re-raise any other unique violation
      GET STACKED DIAGNOSTICS violation_constraint = CONSTRAINT_NAME;
      IF violation_constraint <> 'profiles_username_key' THEN
        RAISE;
      END IF;

      retry_count := retry_count + 1;

      IF retry_count > 5 THEN
        -- Give up on short suffixes; use full UUID username (guaranteed unique)
        default_username := 'user_' || REPLACE(NEW.id::text, '-', '');
        -- Loop back for one final INSERT through the normal path
      ELSE
        -- Generate a random 4-char hex suffix and retry
        username_suffix := LEFT(md5(random()::text), 4);
        default_username := base_username || '_' || username_suffix;
      END IF;
    END;
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Re-grant execute permissions (unchanged from original)
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO authenticated, anon;

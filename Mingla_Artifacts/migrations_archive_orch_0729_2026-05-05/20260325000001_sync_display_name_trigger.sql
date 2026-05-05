-- Trigger: auto-sync display_name when first_name or last_name changes.
-- This ensures display_name is always current, regardless of which code path
-- updates the name (onboarding, profile page, Apple Sign-In, admin, edge functions).

CREATE OR REPLACE FUNCTION public.sync_display_name()
RETURNS TRIGGER AS $$
BEGIN
  -- Only recompute if first_name or last_name actually changed
  IF (NEW.first_name IS DISTINCT FROM OLD.first_name) OR
     (NEW.last_name IS DISTINCT FROM OLD.last_name) THEN
    IF NEW.first_name IS NOT NULL AND TRIM(NEW.first_name) != '' THEN
      IF NEW.last_name IS NOT NULL AND TRIM(NEW.last_name) != '' THEN
        NEW.display_name := TRIM(NEW.first_name) || ' ' || TRIM(NEW.last_name);
      ELSE
        NEW.display_name := TRIM(NEW.first_name);
      END IF;
    END IF;
    -- If first_name is null/empty, leave display_name unchanged
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop if exists to make migration idempotent
DROP TRIGGER IF EXISTS trg_sync_display_name ON public.profiles;

CREATE TRIGGER trg_sync_display_name
  BEFORE UPDATE OF first_name, last_name ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_display_name();

-- Fix handle_new_user privacy leak: display_name was set to full email/phone.
-- Now uses email prefix (before @) for email signups, 'New User' for phone signups.
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

  -- Display name: prefer OAuth-provided name, else email prefix, else 'New User'
  -- PRIVACY: Never use full email or phone number as display_name
  default_display_name := COALESCE(
    NULLIF(TRIM(NEW.raw_user_meta_data->>'display_name'), ''),
    CASE
      WHEN user_email IS NOT NULL AND user_email != ''
        THEN SPLIT_PART(user_email, '@', 1)
      ELSE 'New User'
    END
  );

  -- First name from OAuth metadata, else email prefix
  default_first_name := COALESCE(
    NULLIF(TRIM(NEW.raw_user_meta_data->>'first_name'), ''),
    CASE
      WHEN user_email IS NOT NULL THEN SPLIT_PART(user_email, '@', 1)
      ELSE default_username
    END
  );

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
      GET STACKED DIAGNOSTICS violation_constraint = CONSTRAINT_NAME;

      IF violation_constraint = 'profiles_username_key' THEN
        retry_count := retry_count + 1;
        IF retry_count > 5 THEN
          default_username := 'user_' || LEFT(NEW.id::text, 8) || '_' || LEFT(md5(random()::text), 4);
        ELSE
          username_suffix := LEFT(md5(random()::text), 4);
          default_username := base_username || '_' || username_suffix;
        END IF;
      ELSE
        RAISE;
      END IF;
    END;
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

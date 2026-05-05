-- ADD ACCOUNT_TYPE TO PROFILES MIGRATION
-- Adds account_type column to profiles table and updates the trigger

-- Add account_type column to profiles table
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS account_type TEXT;

-- Add comment to explain the column
COMMENT ON COLUMN public.profiles.account_type IS 'User account type: explorer, curator, business, qa_manager, or admin';

-- Update the handle_new_user function to read account_type from raw_user_meta_data
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  user_email TEXT;
  user_phone TEXT;
  default_display_name TEXT;
  default_username TEXT;
  default_first_name TEXT;
  user_account_type TEXT;
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
  
  -- Determine default display name and username
  -- Priority: metadata > email > phone > 'User'
  IF NEW.raw_user_meta_data->>'username' IS NOT NULL THEN
    default_username := NEW.raw_user_meta_data->>'username';
  ELSIF user_email IS NOT NULL THEN
    default_username := SPLIT_PART(user_email, '@', 1);
  ELSIF user_phone IS NOT NULL THEN
    -- Extract last 6 digits from phone number for username
    default_username := 'user' || RIGHT(REGEXP_REPLACE(user_phone, '[^0-9]', '', 'g'), 6);
  ELSE
    default_username := 'user';
  END IF;
  
  IF NEW.raw_user_meta_data->>'display_name' IS NOT NULL THEN
    default_display_name := NEW.raw_user_meta_data->>'display_name';
  ELSIF user_email IS NOT NULL THEN
    default_display_name := user_email;
  ELSIF user_phone IS NOT NULL THEN
    default_display_name := user_phone;
  ELSE
    default_display_name := 'User';
  END IF;
  
  IF NEW.raw_user_meta_data->>'first_name' IS NOT NULL THEN
    default_first_name := NEW.raw_user_meta_data->>'first_name';
  ELSIF user_email IS NOT NULL THEN
    default_first_name := SPLIT_PART(user_email, '@', 1);
  ELSE
    default_first_name := default_username;
  END IF;
  
  -- Create profile for the new user (support both email and phone)
  -- Set has_completed_onboarding = false for all new users
  -- Include account_type if provided
  INSERT INTO public.profiles (id, email, phone, display_name, username, first_name, last_name, account_type, has_completed_onboarding, created_at, updated_at)
  VALUES (
    NEW.id,
    user_email,
    user_phone,
    default_display_name,
    default_username,
    default_first_name,
    COALESCE(NEW.raw_user_meta_data->>'last_name', ''),
    user_account_type, -- Account type from metadata
    false, -- New users have not completed onboarding
    now(),
    now()
  )
  ON CONFLICT (id) DO NOTHING; -- Prevent duplicate profile creation
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO authenticated, anon;


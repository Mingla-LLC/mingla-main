-- AUTO CREATE PROFILE MIGRATION
-- This creates a trigger to automatically create a profile when a user signs up
-- Uses SECURITY DEFINER to bypass RLS policies

-- Create function to automatically create profile for new users
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  user_email TEXT;
  user_phone TEXT;
  default_display_name TEXT;
  default_username TEXT;
  default_first_name TEXT;
BEGIN
  -- Auto-confirm the user's email/phone to bypass confirmation requirement
  UPDATE auth.users
  SET email_confirmed_at = COALESCE(email_confirmed_at, now()),
      phone_confirmed_at = COALESCE(phone_confirmed_at, now())
  WHERE id = NEW.id;
  
  -- Get email or phone
  user_email := NEW.email;
  user_phone := NEW.phone;
  
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
  INSERT INTO public.profiles (id, email, phone, display_name, username, first_name, last_name, created_at, updated_at)
  VALUES (
    NEW.id,
    user_email,
    user_phone,
    default_display_name,
    default_username,
    default_first_name,
    COALESCE(NEW.raw_user_meta_data->>'last_name', ''),
    now(),
    now()
  )
  ON CONFLICT (id) DO NOTHING; -- Prevent duplicate profile creation
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop existing trigger if it exists
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- Create trigger that fires when a new user is created
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO authenticated, anon;


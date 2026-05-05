-- Migration: 20260303000020_remove_email_auth_artifacts.sql
-- Description: Clean up email-auth-specific defaults and mark email_verified as deprecated.
-- No destructive changes — column stays but is no longer functionally used.

-- Update the handle_new_user trigger to always set email_verified = true for new sign-ups
-- (all sign-ups are now OAuth, which are inherently verified)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (
    id,
    email,
    display_name,
    username,
    first_name,
    avatar_url,
    email_verified,
    has_completed_onboarding,
    onboarding_step,
    created_at,
    updated_at
  )
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(
      NEW.raw_user_meta_data ->> 'full_name',
      NEW.raw_user_meta_data ->> 'name',
      split_part(NEW.email, '@', 1)
    ),
    LOWER(REPLACE(
      COALESCE(
        NEW.raw_user_meta_data ->> 'full_name',
        NEW.raw_user_meta_data ->> 'name',
        split_part(NEW.email, '@', 1)
      ),
      ' ', '_'
    )) || '_' || substr(NEW.id::text, 1, 4),
    COALESCE(
      NEW.raw_user_meta_data ->> 'first_name',
      split_part(COALESCE(NEW.raw_user_meta_data ->> 'full_name', NEW.raw_user_meta_data ->> 'name', ''), ' ', 1)
    ),
    COALESCE(
      NEW.raw_user_meta_data ->> 'avatar_url',
      NEW.raw_user_meta_data ->> 'picture'
    ),
    TRUE,  -- Always true: all sign-ups are now OAuth (inherently verified)
    FALSE,
    NULL,
    NOW(),
    NOW()
  )
  ON CONFLICT (id) DO NOTHING;

  -- Also create default preferences
  INSERT INTO public.preferences (profile_id)
  VALUES (NEW.id)
  ON CONFLICT (profile_id) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

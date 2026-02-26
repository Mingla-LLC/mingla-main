-- Add avatar_url and updated_at columns to profiles table
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS avatar_url text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Create a trigger to automatically update the updated_at column
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Drop the trigger if it exists (to avoid errors)
DROP TRIGGER IF EXISTS update_profiles_updated_at ON public.profiles;

-- Create the trigger
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE
  ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

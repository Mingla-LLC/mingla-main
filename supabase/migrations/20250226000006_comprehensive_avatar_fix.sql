-- Comprehensive fix for profile photo upload
-- Ensure avatar_url and updated_at columns exist and RLS is properly configured

-- Step 1: Ensure avatar_url column exists
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'profiles' AND column_name = 'avatar_url'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN avatar_url text;
  END IF;
END $$;

-- Step 2: Ensure updated_at column exists
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'profiles' AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN updated_at timestamptz DEFAULT now();
  END IF;
END $$;

-- Step 3: Drop ALL existing policies and recreate them properly
DROP POLICY IF EXISTS "Users can read own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;

-- Step 4: Create fresh, working RLS policies
-- SELECT policy - allows users to read their own profile
CREATE POLICY "Users can read own profile" ON public.profiles
  FOR SELECT 
  USING (auth.uid() = id);

-- INSERT policy - allows users to insert their own profile during signup
CREATE POLICY "Users can insert own profile" ON public.profiles
  FOR INSERT 
  WITH CHECK (auth.uid() = id);

-- UPDATE policy - allows users to update their own profile (including avatar_url)
CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE 
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Step 5: Create or replace the trigger for updated_at
DROP TRIGGER IF EXISTS update_profiles_updated_at ON public.profiles;

CREATE OR REPLACE FUNCTION public.update_profiles_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_profiles_updated_at 
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_profiles_updated_at();

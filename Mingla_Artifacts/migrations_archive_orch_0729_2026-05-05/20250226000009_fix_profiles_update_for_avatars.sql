-- Ensure profiles table RLS policies are correct for UPDATE operations
-- Specifically fix the avatar_url field updates

-- Drop all existing policies and recreate them with explicit handling
DROP POLICY IF EXISTS "Users can read own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;

-- SELECT policy
CREATE POLICY "Users can read own profile" ON public.profiles
  FOR SELECT 
  USING (
    auth.uid() = id
  );

-- INSERT policy for initial profile creation
CREATE POLICY "Users can insert own profile" ON public.profiles
  FOR INSERT 
  WITH CHECK (
    auth.uid() = id
  );

-- UPDATE policy - explicitly allow updating avatar_url and other profile fields
CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE 
  USING (
    auth.uid() = id
  )
  WITH CHECK (
    auth.uid() = id
  );

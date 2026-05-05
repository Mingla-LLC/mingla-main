-- Fix RLS policies for profiles table UPDATE operations
-- The UPDATE policy needs both USING and WITH CHECK clauses

-- Drop the existing incomplete policy
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;

-- Create proper UPDATE policy with both USING and WITH CHECK
CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE 
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Also ensure SELECT and INSERT policies are properly set
DROP POLICY IF EXISTS "Users can read own profile" ON public.profiles;
CREATE POLICY "Users can read own profile" ON public.profiles
  FOR SELECT 
  USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
CREATE POLICY "Users can insert own profile" ON public.profiles
  FOR INSERT 
  WITH CHECK (auth.uid() = id);

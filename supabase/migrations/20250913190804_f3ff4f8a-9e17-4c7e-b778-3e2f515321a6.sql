-- Update profiles RLS policy to allow users to view basic profile info of other users
-- This is needed for the friend search functionality

-- Drop the restrictive policies
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
DROP POLICY IF EXISTS "select own profile" ON public.profiles;

-- Create new policy that allows viewing basic profile information for all authenticated users
CREATE POLICY "Authenticated users can view basic profile info" 
ON public.profiles 
FOR SELECT 
USING (auth.role() = 'authenticated'::text);

-- Keep the update and insert policies restrictive (only own profile)
-- Users can still only update their own profile
CREATE POLICY "Users can update own profile only" 
ON public.profiles 
FOR UPDATE 
USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile only" 
ON public.profiles 
FOR INSERT 
WITH CHECK (auth.uid() = id);
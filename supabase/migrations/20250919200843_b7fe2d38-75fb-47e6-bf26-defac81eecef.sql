-- Fix security issue: Restrict profile visibility to authorized relationships only

-- First, create a security definer function to check if a user can view another user's profile
CREATE OR REPLACE FUNCTION public.can_view_profile(target_user_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  -- Users can always view their own profile
  IF auth.uid() = target_user_id THEN
    RETURN TRUE;
  END IF;
  
  -- Users can view profiles of their friends
  IF EXISTS (
    SELECT 1 FROM public.friends 
    WHERE (user_id = auth.uid() AND friend_user_id = target_user_id AND status = 'accepted')
       OR (user_id = target_user_id AND friend_user_id = auth.uid() AND status = 'accepted')
  ) THEN
    RETURN TRUE;
  END IF;
  
  -- Users can view profiles of people they're collaborating with in active sessions
  IF EXISTS (
    SELECT 1 FROM public.session_participants sp1
    JOIN public.session_participants sp2 ON sp1.session_id = sp2.session_id
    JOIN public.collaboration_sessions cs ON sp1.session_id = cs.id
    WHERE sp1.user_id = auth.uid() 
      AND sp2.user_id = target_user_id
      AND sp1.has_accepted = TRUE 
      AND sp2.has_accepted = TRUE
      AND cs.status IN ('active', 'pending')
  ) THEN
    RETURN TRUE;
  END IF;
  
  -- Users can view profiles of people they're collaborating with on boards
  IF EXISTS (
    SELECT 1 FROM public.board_collaborators bc1
    JOIN public.board_collaborators bc2 ON bc1.board_id = bc2.board_id
    WHERE bc1.user_id = auth.uid() 
      AND bc2.user_id = target_user_id
  ) THEN
    RETURN TRUE;
  END IF;
  
  -- Users can view profiles of people who have sent them collaboration invites or vice versa
  IF EXISTS (
    SELECT 1 FROM public.collaboration_invites
    WHERE (invited_user_id = auth.uid() AND invited_by = target_user_id)
       OR (invited_user_id = target_user_id AND invited_by = auth.uid())
  ) THEN
    RETURN TRUE;
  END IF;
  
  -- Default: deny access
  RETURN FALSE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public;

-- Drop the overly permissive existing policies
DROP POLICY IF EXISTS "Authenticated users can view basic profile info" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert own profile only" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile only" ON public.profiles;
DROP POLICY IF EXISTS "insert self" ON public.profiles;
DROP POLICY IF EXISTS "update own profile" ON public.profiles;

-- Create new, secure policies
CREATE POLICY "Users can view authorized profiles only" 
ON public.profiles 
FOR SELECT 
USING (public.can_view_profile(id));

CREATE POLICY "Users can insert their own profile" 
ON public.profiles 
FOR INSERT 
WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update their own profile" 
ON public.profiles 
FOR UPDATE 
USING (auth.uid() = id);

-- Keep the service_role delete policy as is
-- CREATE POLICY "Only service_role can delete profiles" 
-- ON public.profiles 
-- FOR DELETE 
-- USING (auth.role() = 'service_role'::text);
-- Create role-based access control system for experiences table security

-- Step 1: Create an enum for application roles
CREATE TYPE public.app_role AS ENUM ('admin', 'content_manager', 'user');

-- Step 2: Create user_roles table to manage user permissions
CREATE TABLE public.user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    role app_role NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    created_by UUID REFERENCES auth.users(id),
    UNIQUE (user_id, role)
);

-- Enable RLS on user_roles table
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Step 3: Create security definer function to check user roles
-- This prevents recursive RLS issues
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;

-- Step 4: Create helper function to check if user is admin or content manager
CREATE OR REPLACE FUNCTION public.can_manage_content(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role IN ('admin', 'content_manager')
  )
$$;

-- Step 5: Create RLS policies for user_roles table
CREATE POLICY "Users can view their own roles" ON public.user_roles
FOR SELECT 
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Admins can manage all user roles" ON public.user_roles
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Step 6: Update experiences table policies to restrict write access
-- Drop existing permissive policies
DROP POLICY IF EXISTS "Authenticated users can insert experiences" ON public.experiences;
DROP POLICY IF EXISTS "Authenticated users can update experiences" ON public.experiences;

-- Create secure policies that only allow admins and content managers to modify data
CREATE POLICY "Only content managers can insert experiences" ON public.experiences
FOR INSERT 
TO authenticated
WITH CHECK (public.can_manage_content(auth.uid()));

CREATE POLICY "Only content managers can update experiences" ON public.experiences
FOR UPDATE 
TO authenticated
USING (public.can_manage_content(auth.uid()))
WITH CHECK (public.can_manage_content(auth.uid()));

CREATE POLICY "Only admins can delete experiences" ON public.experiences
FOR DELETE 
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Step 7: Add helpful comments
COMMENT ON TABLE public.user_roles IS 'Manages user role assignments for access control';
COMMENT ON TYPE public.app_role IS 'Application roles: admin (full access), content_manager (can edit content), user (read only)';
COMMENT ON FUNCTION public.has_role IS 'Security definer function to check if user has specific role - prevents RLS recursion';
COMMENT ON FUNCTION public.can_manage_content IS 'Checks if user can manage business content (admin or content_manager)';

-- Step 8: Insert a default admin role for the first user (if any exists)
-- This ensures at least one user can manage content initially
DO $$
DECLARE
    first_user_id UUID;
BEGIN
    -- Get the first user from auth.users (if any)
    SELECT id INTO first_user_id FROM auth.users ORDER BY created_at ASC LIMIT 1;
    
    -- If a user exists, make them an admin
    IF first_user_id IS NOT NULL THEN
        INSERT INTO public.user_roles (user_id, role, created_by)
        VALUES (first_user_id, 'admin', first_user_id)
        ON CONFLICT (user_id, role) DO NOTHING;
    END IF;
END $$;
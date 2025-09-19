-- Fix public access to experiences table by restricting to authenticated users only
-- This prevents competitors from scraping business data like pricing, coordinates, and operating hours

-- Drop the existing public read policy
DROP POLICY IF EXISTS "Anyone can read experiences" ON public.experiences;

-- Create new policy that requires authentication
CREATE POLICY "Authenticated users can read experiences" ON public.experiences
FOR SELECT 
TO authenticated
USING (auth.role() = 'authenticated');

-- Update policy comment for clarity
COMMENT ON POLICY "Authenticated users can read experiences" ON public.experiences IS 
'Restricts access to experiences data to authenticated users only to protect sensitive business information';
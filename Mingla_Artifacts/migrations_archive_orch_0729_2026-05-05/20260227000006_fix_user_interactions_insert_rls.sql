-- Ensure user_interactions inserts are reliable under RLS for authenticated users
-- while preserving strict ownership checks.

ALTER TABLE public.user_interactions
  ALTER COLUMN user_id SET DEFAULT auth.uid();

DROP POLICY IF EXISTS "Users can insert their own interactions" ON public.user_interactions;

CREATE POLICY "Users can insert their own interactions" ON public.user_interactions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND user_id = auth.uid()
  );

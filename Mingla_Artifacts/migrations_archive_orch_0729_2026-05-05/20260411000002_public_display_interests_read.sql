-- ORCH-0374: Allow all authenticated users to read display interests
-- display_intents and display_categories are cosmetic profile data,
-- safe to read publicly. The existing "Friends can read friend preferences"
-- policy is too restrictive — interests should be visible to all viewers.

CREATE POLICY "Authenticated users can read display interests"
  ON public.preferences FOR SELECT
  USING (auth.uid() IS NOT NULL);

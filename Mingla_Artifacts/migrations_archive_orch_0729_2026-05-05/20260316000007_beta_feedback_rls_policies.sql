-- RLS policies for beta_feedback table
ALTER TABLE beta_feedback ENABLE ROW LEVEL SECURITY;

-- Beta testers can read their own feedback
CREATE POLICY "Users can read own feedback"
  ON beta_feedback FOR SELECT
  USING (auth.uid() = user_id);

-- Beta testers can insert their own feedback
CREATE POLICY "Beta testers can insert feedback"
  ON beta_feedback FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_beta_tester = true)
  );

-- Admins can read all feedback
CREATE POLICY "Admins can read all feedback"
  ON beta_feedback FOR SELECT
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));

-- Admins can update feedback (status, notes)
CREATE POLICY "Admins can update feedback"
  ON beta_feedback FOR UPDATE
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));

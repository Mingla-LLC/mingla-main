-- Create app_feedback table for collecting user feedback and ratings
CREATE TABLE IF NOT EXISTS app_feedback (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  rating integer CHECK (rating BETWEEN 1 AND 5),
  message text,
  category text,
  platform text DEFAULT 'mobile',
  created_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE app_feedback ENABLE ROW LEVEL SECURITY;

-- Users can insert their own feedback
CREATE POLICY "Users can insert own feedback"
  ON app_feedback
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can read their own feedback
CREATE POLICY "Users can read own feedback"
  ON app_feedback
  FOR SELECT
  USING (auth.uid() = user_id);

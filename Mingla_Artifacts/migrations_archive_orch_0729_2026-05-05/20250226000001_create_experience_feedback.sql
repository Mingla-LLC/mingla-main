-- Create experience_feedback table for collecting post-scheduling feedback
CREATE TABLE IF NOT EXISTS experience_feedback (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  card_id text NOT NULL,
  experience_title text,
  rating integer CHECK (rating BETWEEN 1 AND 5) NOT NULL,
  feedback_text text,
  created_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE experience_feedback ENABLE ROW LEVEL SECURITY;

-- Users can insert their own feedback
CREATE POLICY "Users can insert own experience feedback"
  ON experience_feedback
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can read their own feedback
CREATE POLICY "Users can read own experience feedback"
  ON experience_feedback
  FOR SELECT
  USING (auth.uid() = user_id);

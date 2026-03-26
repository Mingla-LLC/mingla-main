CREATE TABLE IF NOT EXISTS public.user_taste_matches (
  user_a_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  user_b_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  match_percentage INTEGER NOT NULL CHECK (match_percentage BETWEEN 0 AND 100),
  shared_categories TEXT[] NOT NULL DEFAULT '{}',
  shared_tiers TEXT[] NOT NULL DEFAULT '{}',
  shared_intents TEXT[] NOT NULL DEFAULT '{}',
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_a_id, user_b_id),
  CHECK (user_a_id < user_b_id)
);

ALTER TABLE public.user_taste_matches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own taste matches"
  ON public.user_taste_matches FOR SELECT
  USING (auth.uid() = user_a_id OR auth.uid() = user_b_id);

CREATE POLICY "Service role manages taste matches"
  ON public.user_taste_matches FOR ALL
  USING (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_taste_matches_user_a ON public.user_taste_matches (user_a_id);
CREATE INDEX IF NOT EXISTS idx_taste_matches_user_b ON public.user_taste_matches (user_b_id);
CREATE INDEX IF NOT EXISTS idx_taste_matches_stale ON public.user_taste_matches (computed_at);

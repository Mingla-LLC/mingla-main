-- Migration: create_session_decks
-- Stores the canonical deck for each collaboration session.
-- All participants fetch cards from this table instead of generating independently.

CREATE TABLE public.session_decks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.collaboration_sessions(id) ON DELETE CASCADE,
  deck_version INTEGER NOT NULL DEFAULT 1,
  cards JSONB NOT NULL DEFAULT '[]'::JSONB,
  preferences_hash TEXT NOT NULL,
  batch_seed INTEGER NOT NULL DEFAULT 0,
  total_cards INTEGER NOT NULL DEFAULT 0,
  has_more BOOLEAN NOT NULL DEFAULT true,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
  UNIQUE(session_id, deck_version, batch_seed)
);

CREATE INDEX idx_session_decks_session_id ON public.session_decks(session_id);
CREATE INDEX idx_session_decks_generated_at ON public.session_decks(generated_at DESC);

ALTER TABLE public.session_decks ENABLE ROW LEVEL SECURITY;

-- Participants can read their session's deck
CREATE POLICY "Participants can read session decks"
  ON public.session_decks FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.session_participants sp
      WHERE sp.session_id = session_decks.session_id
      AND sp.user_id = auth.uid()
    )
  );

-- Only the system (service role) inserts/updates decks
-- No INSERT/UPDATE/DELETE policies for authenticated users

-- ===========================================
-- COLLABORATION FEATURE MIGRATION - PART 1
-- Extend collaboration_sessions and collaboration_invites tables
-- ===========================================

-- Extend collaboration_sessions with board-specific fields
ALTER TABLE public.collaboration_sessions
ADD COLUMN IF NOT EXISTS session_type TEXT DEFAULT 'group_hangout' 
  CHECK (session_type IN ('group_hangout', 'date_night', 'squad_outing', 'business_meeting')),
ADD COLUMN IF NOT EXISTS board_id UUID REFERENCES public.boards(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS invite_code TEXT UNIQUE,
ADD COLUMN IF NOT EXISTS invite_link TEXT,
ADD COLUMN IF NOT EXISTS max_participants INTEGER DEFAULT 15,
ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ DEFAULT now(),
ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

-- Create index for invite_code lookups
CREATE INDEX IF NOT EXISTS idx_collaboration_sessions_invite_code 
  ON public.collaboration_sessions(invite_code) 
  WHERE invite_code IS NOT NULL;

-- Extend collaboration_invites with additional invite methods
ALTER TABLE public.collaboration_invites
ADD COLUMN IF NOT EXISTS invite_method TEXT DEFAULT 'friends_list' 
  CHECK (invite_method IN ('friends_list', 'link', 'qr_code', 'invite_code')),
ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ;

-- Function to generate invite codes
CREATE OR REPLACE FUNCTION public.generate_invite_code()
RETURNS TEXT AS $$
DECLARE
  chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- Excluding confusing chars
  code TEXT := '';
  i INTEGER;
BEGIN
  FOR i IN 1..6 LOOP
    code := code || substr(chars, floor(random() * length(chars) + 1)::INTEGER, 1);
  END LOOP;
  RETURN 'MINGLA-' || code;
END;
$$ LANGUAGE plpgsql;

-- Function to auto-generate invite code and link when session is created
CREATE OR REPLACE FUNCTION public.auto_generate_invite_info()
RETURNS TRIGGER AS $$
BEGIN
  -- Generate invite code if not provided
  IF NEW.invite_code IS NULL THEN
    LOOP
      NEW.invite_code := public.generate_invite_code();
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM public.collaboration_sessions 
        WHERE invite_code = NEW.invite_code
      );
    END LOOP;
  END IF;
  
  -- Generate invite link if not provided
  IF NEW.invite_link IS NULL THEN
    NEW.invite_link := 'mingla://board/' || NEW.invite_code;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER auto_generate_invite_on_session_create
  BEFORE INSERT ON public.collaboration_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_generate_invite_info();


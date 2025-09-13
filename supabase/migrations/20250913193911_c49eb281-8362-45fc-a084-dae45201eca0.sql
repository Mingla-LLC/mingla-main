-- Create collaboration sessions table
CREATE TABLE public.collaboration_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  created_by UUID NOT NULL,
  board_id UUID NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'dormant')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.collaboration_sessions ENABLE ROW LEVEL SECURITY;

-- Create session participants table
CREATE TABLE public.session_participants (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID NOT NULL,
  user_id UUID NOT NULL,
  has_accepted BOOLEAN NOT NULL DEFAULT false,
  joined_at TIMESTAMP WITH TIME ZONE NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(session_id, user_id)
);

-- Enable RLS
ALTER TABLE public.session_participants ENABLE ROW LEVEL SECURITY;

-- Create collaboration invites table
CREATE TABLE public.collaboration_invites (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID NOT NULL,
  invited_by UUID NOT NULL,
  invited_user_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled')),
  message TEXT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(session_id, invited_user_id)
);

-- Enable RLS
ALTER TABLE public.collaboration_invites ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for collaboration_sessions
CREATE POLICY "Users can view sessions they created or participate in" 
ON public.collaboration_sessions 
FOR SELECT 
USING (
  (auth.uid() = created_by) OR 
  (EXISTS (
    SELECT 1 FROM session_participants 
    WHERE session_participants.session_id = collaboration_sessions.id 
    AND session_participants.user_id = auth.uid()
  ))
);

CREATE POLICY "Users can create sessions" 
ON public.collaboration_sessions 
FOR INSERT 
WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Session creators can update their sessions" 
ON public.collaboration_sessions 
FOR UPDATE 
USING (auth.uid() = created_by);

-- Create RLS policies for session_participants
CREATE POLICY "Users can view participants of their sessions" 
ON public.session_participants 
FOR SELECT 
USING (
  (auth.uid() = user_id) OR 
  (EXISTS (
    SELECT 1 FROM collaboration_sessions 
    WHERE collaboration_sessions.id = session_participants.session_id 
    AND collaboration_sessions.created_by = auth.uid()
  ))
);

CREATE POLICY "Session creators can add participants" 
ON public.session_participants 
FOR INSERT 
WITH CHECK (
  EXISTS (
    SELECT 1 FROM collaboration_sessions 
    WHERE collaboration_sessions.id = session_participants.session_id 
    AND collaboration_sessions.created_by = auth.uid()
  )
);

CREATE POLICY "Users can update their own participation" 
ON public.session_participants 
FOR UPDATE 
USING (auth.uid() = user_id);

-- Create RLS policies for collaboration_invites
CREATE POLICY "Users can view invites they sent or received" 
ON public.collaboration_invites 
FOR SELECT 
USING ((auth.uid() = invited_by) OR (auth.uid() = invited_user_id));

CREATE POLICY "Users can create invites for their sessions" 
ON public.collaboration_invites 
FOR INSERT 
WITH CHECK (
  (auth.uid() = invited_by) AND 
  (EXISTS (
    SELECT 1 FROM collaboration_sessions 
    WHERE collaboration_sessions.id = collaboration_invites.session_id 
    AND collaboration_sessions.created_by = auth.uid()
  ))
);

CREATE POLICY "Users can update invites they sent or received" 
ON public.collaboration_invites 
FOR UPDATE 
USING ((auth.uid() = invited_by) OR (auth.uid() = invited_user_id));

-- Create triggers for updated_at
CREATE TRIGGER update_collaboration_sessions_updated_at
BEFORE UPDATE ON public.collaboration_sessions
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_collaboration_invites_updated_at
BEFORE UPDATE ON public.collaboration_invites
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
-- Create boards table 
CREATE TABLE IF NOT EXISTS public.boards (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NULL,
  created_by UUID NOT NULL,
  session_id UUID NULL,
  is_public BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.boards ENABLE ROW LEVEL SECURITY;

-- Create board collaborators table
CREATE TABLE IF NOT EXISTS public.board_collaborators (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  board_id UUID NOT NULL,
  user_id UUID NOT NULL,
  role TEXT NOT NULL DEFAULT 'collaborator' CHECK (role IN ('owner', 'collaborator')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(board_id, user_id)
);

-- Enable RLS
ALTER TABLE public.board_collaborators ENABLE ROW LEVEL SECURITY;

-- Create boards RLS policies
CREATE POLICY "Users can view public boards and their own boards" 
ON public.boards 
FOR SELECT 
USING (
  is_public = true OR 
  auth.uid() = created_by OR
  (session_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM session_participants 
    WHERE session_participants.session_id = boards.session_id 
    AND session_participants.user_id = auth.uid()
    AND session_participants.has_accepted = true
  ))
);

CREATE POLICY "Users can create boards" 
ON public.boards 
FOR INSERT 
WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Board creators can update their boards" 
ON public.boards 
FOR UPDATE 
USING (
  auth.uid() = created_by OR
  (session_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM session_participants 
    WHERE session_participants.session_id = boards.session_id 
    AND session_participants.user_id = auth.uid()
    AND session_participants.has_accepted = true
  ))
);

-- Create board collaborators RLS policies
CREATE POLICY "Users can view collaborators of boards they have access to" 
ON public.board_collaborators 
FOR SELECT 
USING (
  auth.uid() = user_id OR
  EXISTS (
    SELECT 1 FROM boards 
    WHERE boards.id = board_collaborators.board_id 
    AND (
      boards.created_by = auth.uid() OR
      boards.is_public = true OR
      (boards.session_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM session_participants 
        WHERE session_participants.session_id = boards.session_id 
        AND session_participants.user_id = auth.uid()
        AND session_participants.has_accepted = true
      ))
    )
  )
);

CREATE POLICY "Board owners can add collaborators" 
ON public.board_collaborators 
FOR INSERT 
WITH CHECK (
  EXISTS (
    SELECT 1 FROM boards 
    WHERE boards.id = board_collaborators.board_id 
    AND boards.created_by = auth.uid()
  )
);

-- Add trigger for updated_at on boards
CREATE TRIGGER update_boards_updated_at
BEFORE UPDATE ON public.boards
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
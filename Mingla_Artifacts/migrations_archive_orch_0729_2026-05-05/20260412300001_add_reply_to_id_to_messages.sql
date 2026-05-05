-- Add reply_to_id to direct messages table (parity with board_messages which already has it)
ALTER TABLE public.messages
  ADD COLUMN reply_to_id UUID REFERENCES public.messages(id) ON DELETE SET NULL;

CREATE INDEX idx_messages_reply_to
  ON public.messages(reply_to_id) WHERE reply_to_id IS NOT NULL;

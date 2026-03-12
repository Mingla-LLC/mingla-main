-- Migration: 20260312200002_add_message_read_status_columns.sql
-- Description: Add is_read shortcut to messages table for efficient read receipt display.
-- The message_reads table already exists for detailed tracking.
-- This column is a denormalized shortcut so the client doesn't need to JOIN on every message render.

ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS is_read BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;

-- Update existing messages: mark as read if they have a corresponding message_reads entry
UPDATE public.messages m
SET is_read = true, read_at = mr.read_at
FROM public.message_reads mr
WHERE mr.message_id = m.id;

-- Trigger: when a message_reads row is inserted, update the message's is_read flag
CREATE OR REPLACE FUNCTION sync_message_read_status()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.messages
  SET is_read = true, read_at = NEW.read_at
  WHERE id = NEW.message_id AND is_read = false;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_sync_message_read_status
  AFTER INSERT ON public.message_reads
  FOR EACH ROW
  EXECUTE FUNCTION sync_message_read_status();

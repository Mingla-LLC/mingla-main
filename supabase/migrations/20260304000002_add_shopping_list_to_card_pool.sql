-- Add shopping_list column to card_pool for picnic-dates intent
-- Stores AI-generated shopping checklist as JSONB array of strings
ALTER TABLE public.card_pool ADD COLUMN IF NOT EXISTS shopping_list JSONB;

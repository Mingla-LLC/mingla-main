-- ORCH-0667 — Add card message type to direct messages.
-- Enables sharing saved cards from sender to recipient via DM.
-- Schema delta Option A (per investigation §8): widen message_type CHECK
-- + add card_payload jsonb + soft constraint requiring payload when type=card.
-- RLS unchanged: existing message SELECT/INSERT policies do not discriminate
-- by message_type; new card-type rows inherit existing per-conversation rules.

BEGIN;

-- 1. Widen the message_type CHECK constraint
ALTER TABLE public.messages
  DROP CONSTRAINT IF EXISTS messages_message_type_check;

ALTER TABLE public.messages
  ADD CONSTRAINT messages_message_type_check
  CHECK (message_type IN ('text', 'image', 'video', 'file', 'card'));

-- 2. Add the card_payload column (snapshot, per investigation D-2)
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS card_payload jsonb;

-- 3. Soft constraint: card_payload required when message_type = 'card'
ALTER TABLE public.messages
  DROP CONSTRAINT IF EXISTS messages_card_requires_payload;

ALTER TABLE public.messages
  ADD CONSTRAINT messages_card_requires_payload
  CHECK (message_type <> 'card' OR card_payload IS NOT NULL);

COMMENT ON COLUMN public.messages.card_payload IS
  'ORCH-0667: Snapshot of shared card data when message_type=card. '
  'Trimmed schema per spec §6 to stay <5KB. Snapshot (not reference) '
  'so the bubble survives the place being removed from the pool '
  '(cross-ref ORCH-0659.D-1 backfill lesson — distance is user-relative '
  'and place-pool churn is non-trivial).';

COMMIT;

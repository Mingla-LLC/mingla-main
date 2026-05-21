-- ORCH-0908 (bundled scope): add card_tags column to messages for #-tag chat feature.
-- Mirrors mentions column pattern. Default '[]' so existing rows + writes without tags work.
--
-- Filename note: SPEC_ORCH-0908 requested 20260701000000, but that version is already
-- occupied locally and on the linked remote by ORCH-0909 positional shared deck. This
-- migration intentionally uses the next monotonic prefix to keep Supabase history safe.
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS card_tags jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.messages.card_tags IS
  'ORCH-0908: array of {savedCardId, cardPayload} objects for #-tagged cards. cardPayload built via trimCardPayload (ORCH-0667/0685 contract). Cap 5 per message enforced at app layer. Per-message embed; tap renders ExpandedCardModal via cardPayloadToExpandedCardData. NULL-tolerant render: missing cardPayload -> chip falls back to title-only.';

-- No RLS change needed: messages.card_tags is per-row data, RLS already covers row access.

NOTIFY pgrst, 'reload schema';

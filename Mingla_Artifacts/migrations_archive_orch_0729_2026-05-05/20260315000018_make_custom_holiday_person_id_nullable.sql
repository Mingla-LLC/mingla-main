-- ============================================================
-- Make person_id nullable on custom_holidays and archived_holidays
-- Pairing-based holidays use pairing_id + paired_user_id instead
-- of the legacy person_id (which references saved_people).
-- ============================================================

-- custom_holidays: allow NULL person_id when pairing_id is set
ALTER TABLE public.custom_holidays ALTER COLUMN person_id DROP NOT NULL;

-- archived_holidays: allow NULL person_id when pairing_id is set
ALTER TABLE public.archived_holidays ALTER COLUMN person_id DROP NOT NULL;

-- Add check constraint: at least one of person_id or pairing_id must be set
ALTER TABLE public.custom_holidays
  ADD CONSTRAINT chk_custom_holidays_person_or_pairing
  CHECK (person_id IS NOT NULL OR pairing_id IS NOT NULL);

ALTER TABLE public.archived_holidays
  ADD CONSTRAINT chk_archived_holidays_person_or_pairing
  CHECK (person_id IS NOT NULL OR pairing_id IS NOT NULL);

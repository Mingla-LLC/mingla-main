-- ============================================================
-- Pairing Feature: Add pairing columns to existing tables
-- ============================================================

-- custom_holidays: these tables may or may not exist yet.
-- Use IF NOT EXISTS / IF EXISTS guards for safety.

-- Add pairing columns to custom_holidays (if table exists)
DO $$ BEGIN
    ALTER TABLE custom_holidays ADD COLUMN IF NOT EXISTS pairing_id UUID REFERENCES pairings(id) ON DELETE CASCADE;
    ALTER TABLE custom_holidays ADD COLUMN IF NOT EXISTS paired_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN undefined_table THEN
    RAISE NOTICE 'custom_holidays table does not exist, skipping';
END $$;

-- Add pairing columns to person_card_impressions (if table exists)
DO $$ BEGIN
    ALTER TABLE person_card_impressions ADD COLUMN IF NOT EXISTS paired_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN undefined_table THEN
    RAISE NOTICE 'person_card_impressions table does not exist, skipping';
END $$;

-- Add pairing columns to archived_holidays (if table exists)
DO $$ BEGIN
    ALTER TABLE archived_holidays ADD COLUMN IF NOT EXISTS pairing_id UUID REFERENCES pairings(id) ON DELETE CASCADE;
    ALTER TABLE archived_holidays ADD COLUMN IF NOT EXISTS paired_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN undefined_table THEN
    RAISE NOTICE 'archived_holidays table does not exist, skipping';
END $$;

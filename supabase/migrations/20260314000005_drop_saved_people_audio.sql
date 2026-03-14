-- ============================================================
-- Pairing Feature: Cleanup — drop legacy saved people audio tables
-- ============================================================

DROP TABLE IF EXISTS person_audio_clips CASCADE;
DROP TABLE IF EXISTS person_experiences CASCADE;

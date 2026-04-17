-- ===========================================
-- ORCH-0437: Near You Leaderboard — Phase 1
-- Migration 4: Add leaderboard settings to user_map_settings
-- ===========================================

-- Persisted leaderboard preferences (source of truth).
-- leaderboard_presence holds the transient copy.
-- When a collab session ends, the trigger restores from these persisted values.

ALTER TABLE public.user_map_settings
  ADD COLUMN IF NOT EXISTS available_seats INTEGER NOT NULL DEFAULT 1
    CHECK (available_seats BETWEEN 1 AND 5);

ALTER TABLE public.user_map_settings
  ADD COLUMN IF NOT EXISTS is_discoverable BOOLEAN NOT NULL DEFAULT false;

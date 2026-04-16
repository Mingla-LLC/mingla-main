-- ORCH-0437: Allow "no limit" seats (value 99) in both tables.
-- 99 = no seat limit (user accepts unlimited tag-alongs).

-- Drop old constraint and add new one on user_map_settings
ALTER TABLE public.user_map_settings DROP CONSTRAINT IF EXISTS user_map_settings_available_seats_check;
ALTER TABLE public.user_map_settings ADD CONSTRAINT user_map_settings_available_seats_check
  CHECK (available_seats BETWEEN 1 AND 99);

-- Drop old constraint and add new one on leaderboard_presence
ALTER TABLE public.leaderboard_presence DROP CONSTRAINT IF EXISTS leaderboard_presence_available_seats_check;
ALTER TABLE public.leaderboard_presence ADD CONSTRAINT leaderboard_presence_available_seats_check
  CHECK (available_seats BETWEEN 0 AND 99);

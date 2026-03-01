ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS use_gps_location BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN user_preferences.use_gps_location IS
  'true = always use device GPS; false = use custom_location field';

-- Also apply to preferences table (the actual table name in this schema)
ALTER TABLE preferences
  ADD COLUMN IF NOT EXISTS use_gps_location BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN preferences.use_gps_location IS
  'true = always use device GPS; false = use custom_location field';

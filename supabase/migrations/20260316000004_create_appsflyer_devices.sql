-- AppsFlyer device registry for S2S event delivery.
-- Stores the SDK-generated AppsFlyer UID per device so edge functions
-- can POST server-to-server events (e.g. referral_completed) without
-- requiring the user's device to be online.

CREATE TABLE appsflyer_devices (
  id         uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  appsflyer_uid text     NOT NULL,
  platform   text        NOT NULL CHECK (platform IN ('ios', 'android')),
  app_id     text        NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (user_id, appsflyer_uid)
);

CREATE INDEX idx_appsflyer_devices_user_id ON appsflyer_devices(user_id);

ALTER TABLE appsflyer_devices ENABLE ROW LEVEL SECURITY;

-- Users can register their own devices
CREATE POLICY "appsflyer_devices_insert_own"
  ON appsflyer_devices FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can read their own device rows
CREATE POLICY "appsflyer_devices_select_own"
  ON appsflyer_devices FOR SELECT
  USING (auth.uid() = user_id);

-- Users can update their own device rows (updated_at refresh)
CREATE POLICY "appsflyer_devices_update_own"
  ON appsflyer_devices FOR UPDATE
  USING (auth.uid() = user_id);

-- Users can delete their own device rows (logout / device cleanup)
CREATE POLICY "appsflyer_devices_delete_own"
  ON appsflyer_devices FOR DELETE
  USING (auth.uid() = user_id);

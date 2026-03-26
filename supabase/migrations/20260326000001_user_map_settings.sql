-- User map privacy + location settings.
-- PRIVACY: visibility defaults to 'friends' — friends and paired people can see each other.
-- Strangers require explicit 'everyone' opt-in.
-- LOCATION: Only approximate_lat/lng (500m offset) is exposed via edge function.
-- real_lat/lng is NEVER returned to any client — only used for offset computation.

CREATE TABLE IF NOT EXISTS public.user_map_settings (
  user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  visibility_level TEXT NOT NULL DEFAULT 'friends'
    CHECK (visibility_level IN ('off', 'paired', 'friends', 'everyone')),
  show_saved_places BOOLEAN NOT NULL DEFAULT false,
  show_scheduled_places BOOLEAN NOT NULL DEFAULT false,
  activity_status TEXT DEFAULT NULL,
  activity_status_expires_at TIMESTAMPTZ DEFAULT NULL,
  discovery_radius_km INTEGER NOT NULL DEFAULT 5
    CHECK (discovery_radius_km IN (1, 5, 15, 50)),
  time_delay_enabled BOOLEAN NOT NULL DEFAULT false,
  approximate_lat DOUBLE PRECISION,
  approximate_lng DOUBLE PRECISION,
  approximate_location_updated_at TIMESTAMPTZ,
  real_lat DOUBLE PRECISION,
  real_lng DOUBLE PRECISION,
  last_active_at TIMESTAMPTZ DEFAULT NOW(),
  go_dark_until TIMESTAMPTZ DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.user_map_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own map settings"
  ON public.user_map_settings FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_user_map_settings_approx_location
  ON public.user_map_settings (approximate_lat, approximate_lng)
  WHERE visibility_level != 'off';

CREATE INDEX IF NOT EXISTS idx_user_map_settings_visibility
  ON public.user_map_settings (visibility_level)
  WHERE visibility_level != 'off';

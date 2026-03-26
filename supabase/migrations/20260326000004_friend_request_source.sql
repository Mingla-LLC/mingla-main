ALTER TABLE public.friend_requests
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'app'
  CHECK (source IN ('app', 'map', 'onboarding', 'session'));

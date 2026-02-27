CREATE TABLE IF NOT EXISTS public.discover_daily_cache (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  us_date_key DATE NOT NULL,
  cards JSONB NOT NULL DEFAULT '[]'::jsonb,
  featured_card JSONB,
  generated_location JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, us_date_key)
);

CREATE INDEX IF NOT EXISTS idx_discover_daily_cache_user_date
  ON public.discover_daily_cache (user_id, us_date_key DESC);

ALTER TABLE public.discover_daily_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "discover_daily_cache_select_own" ON public.discover_daily_cache;
CREATE POLICY "discover_daily_cache_select_own"
  ON public.discover_daily_cache
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "discover_daily_cache_insert_own" ON public.discover_daily_cache;
CREATE POLICY "discover_daily_cache_insert_own"
  ON public.discover_daily_cache
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "discover_daily_cache_update_own" ON public.discover_daily_cache;
CREATE POLICY "discover_daily_cache_update_own"
  ON public.discover_daily_cache
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS update_discover_daily_cache_updated_at
  ON public.discover_daily_cache;

CREATE TRIGGER update_discover_daily_cache_updated_at
  BEFORE UPDATE ON public.discover_daily_cache
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

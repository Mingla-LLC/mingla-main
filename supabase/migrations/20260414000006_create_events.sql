CREATE TABLE IF NOT EXISTS public.events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  venue_id uuid REFERENCES public.place_pool(id) ON DELETE SET NULL,
  business_profile_id uuid REFERENCES public.business_profiles(id) ON DELETE SET NULL,
  name text NOT NULL,
  description text,
  cover_image_url text,
  theme text,
  categories jsonb NOT NULL DEFAULT '[]',
  tags jsonb NOT NULL DEFAULT '[]',
  event_type text NOT NULL CHECK (event_type IN ('ticketed', 'free', 'dining')),
  privacy text NOT NULL DEFAULT 'public' CHECK (privacy IN ('public', 'friends', 'invite')),
  password text,
  start_time timestamptz NOT NULL,
  end_time timestamptz,
  location_name text,
  location_address text,
  location_lat double precision,
  location_lng double precision,
  online_url text,
  is_recurring boolean NOT NULL DEFAULT false,
  recurring_pattern jsonb,
  capacity integer,
  allow_plus_ones boolean NOT NULL DEFAULT true,
  max_plus_ones integer NOT NULL DEFAULT 1,
  require_approval boolean NOT NULL DEFAULT false,
  hide_location boolean NOT NULL DEFAULT true,
  custom_questions jsonb NOT NULL DEFAULT '[]',
  guest_list_visible boolean NOT NULL DEFAULT true,
  kickback_enabled boolean NOT NULL DEFAULT false,
  kickback_commission_pct numeric(4,2),
  all_in_pricing boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'cancelled', 'completed')),
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_events_creator ON public.events (creator_id);
CREATE INDEX IF NOT EXISTS idx_events_venue ON public.events (venue_id) WHERE venue_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_status_start ON public.events (status, start_time) WHERE status = 'published';
CREATE INDEX IF NOT EXISTS idx_events_geo ON public.events (location_lat, location_lng) WHERE location_lat IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_start_time ON public.events (start_time);

ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "events_creator_all" ON public.events FOR ALL TO authenticated
    USING (auth.uid() = creator_id) WITH CHECK (auth.uid() = creator_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "events_public_read" ON public.events FOR SELECT TO authenticated
    USING (status = 'published' AND privacy = 'public');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "events_invite_read" ON public.events FOR SELECT TO authenticated
    USING (status = 'published' AND privacy = 'invite');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "events_anon_read" ON public.events FOR SELECT TO anon
    USING (status = 'published' AND (privacy = 'public' OR privacy = 'invite'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "events_service_role" ON public.events FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DROP TRIGGER IF EXISTS trg_events_updated_at ON public.events;
CREATE TRIGGER trg_events_updated_at BEFORE UPDATE ON public.events FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.events IS 'Business-created events: ticketed, free RSVP, or dining reservation.';

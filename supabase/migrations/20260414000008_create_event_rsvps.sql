CREATE TABLE IF NOT EXISTS public.event_rsvps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('going', 'maybe', 'not_going', 'waitlisted', 'pending_approval')),
  plus_ones integer NOT NULL DEFAULT 0,
  custom_answers jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_event_rsvps_event ON public.event_rsvps (event_id);
CREATE INDEX IF NOT EXISTS idx_event_rsvps_user ON public.event_rsvps (user_id);
CREATE INDEX IF NOT EXISTS idx_event_rsvps_event_status ON public.event_rsvps (event_id, status);

ALTER TABLE public.event_rsvps ENABLE ROW LEVEL SECURITY;

-- User can CRUD own RSVPs
DO $$ BEGIN
  CREATE POLICY "er_user_all" ON public.event_rsvps FOR ALL TO authenticated
    USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Event creator can read all RSVPs for their events
DO $$ BEGIN
  CREATE POLICY "er_creator_read" ON public.event_rsvps FOR SELECT TO authenticated
    USING (event_id IN (SELECT id FROM public.events WHERE creator_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Authenticated users can read RSVPs for public events (for social proof)
DO $$ BEGIN
  CREATE POLICY "er_public_read" ON public.event_rsvps FOR SELECT TO authenticated
    USING (event_id IN (SELECT id FROM public.events WHERE status = 'published' AND privacy = 'public'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "er_service_role" ON public.event_rsvps FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DROP TRIGGER IF EXISTS trg_event_rsvps_updated_at ON public.event_rsvps;
CREATE TRIGGER trg_event_rsvps_updated_at BEFORE UPDATE ON public.event_rsvps FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.event_tracking_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  name text NOT NULL,
  code text NOT NULL UNIQUE,
  clicks integer NOT NULL DEFAULT 0,
  conversions integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_etl_event ON public.event_tracking_links (event_id);
CREATE INDEX IF NOT EXISTS idx_etl_code ON public.event_tracking_links (code);

ALTER TABLE public.event_tracking_links ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "etl_creator_all" ON public.event_tracking_links FOR ALL TO authenticated
    USING (event_id IN (SELECT id FROM public.events WHERE creator_id = auth.uid()))
    WITH CHECK (event_id IN (SELECT id FROM public.events WHERE creator_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "etl_service_role" ON public.event_tracking_links FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

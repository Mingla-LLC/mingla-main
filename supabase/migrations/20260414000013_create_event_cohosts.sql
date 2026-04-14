CREATE TABLE IF NOT EXISTS public.event_cohosts (
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'cohost' CHECK (role IN ('cohost', 'doorperson')),
  scanner_pin text,
  PRIMARY KEY (event_id, user_id)
);

ALTER TABLE public.event_cohosts ENABLE ROW LEVEL SECURITY;

-- Event creator can manage cohosts
DO $$ BEGIN
  CREATE POLICY "ec_creator_all" ON public.event_cohosts FOR ALL TO authenticated
    USING (event_id IN (SELECT id FROM public.events WHERE creator_id = auth.uid()))
    WITH CHECK (event_id IN (SELECT id FROM public.events WHERE creator_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Cohosts can read their own entries
DO $$ BEGIN
  CREATE POLICY "ec_self_read" ON public.event_cohosts FOR SELECT TO authenticated
    USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "ec_service_role" ON public.event_cohosts FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

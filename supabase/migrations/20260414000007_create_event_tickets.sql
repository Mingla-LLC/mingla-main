CREATE TABLE IF NOT EXISTS public.event_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  tier_name text NOT NULL,
  price numeric(10,2) NOT NULL,
  currency text NOT NULL DEFAULT 'USD',
  quantity integer NOT NULL,
  sold_count integer NOT NULL DEFAULT 0,
  description text,
  is_visible boolean NOT NULL DEFAULT true,
  purchase_limit integer NOT NULL DEFAULT 10,
  sale_start timestamptz,
  sale_end timestamptz,
  sort_order integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_event_tickets_event ON public.event_tickets (event_id);

ALTER TABLE public.event_tickets ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "et_creator_all" ON public.event_tickets FOR ALL TO authenticated
    USING (event_id IN (SELECT id FROM public.events WHERE creator_id = auth.uid()))
    WITH CHECK (event_id IN (SELECT id FROM public.events WHERE creator_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "et_public_read" ON public.event_tickets FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "et_anon_read" ON public.event_tickets FOR SELECT TO anon USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "et_service_role" ON public.event_tickets FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

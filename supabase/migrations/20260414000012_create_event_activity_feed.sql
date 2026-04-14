CREATE TABLE IF NOT EXISTS public.event_activity_feed (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content text NOT NULL,
  type text NOT NULL DEFAULT 'comment' CHECK (type IN ('comment', 'gif', 'reaction')),
  parent_id uuid REFERENCES public.event_activity_feed(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_eaf_event ON public.event_activity_feed (event_id, created_at);
CREATE INDEX IF NOT EXISTS idx_eaf_parent ON public.event_activity_feed (parent_id) WHERE parent_id IS NOT NULL;

ALTER TABLE public.event_activity_feed ENABLE ROW LEVEL SECURITY;

-- Authenticated can insert comments on published events
DO $$ BEGIN
  CREATE POLICY "eaf_insert" ON public.event_activity_feed FOR INSERT TO authenticated
    WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Authenticated can read feed for public events
DO $$ BEGIN
  CREATE POLICY "eaf_public_read" ON public.event_activity_feed FOR SELECT TO authenticated
    USING (event_id IN (SELECT id FROM public.events WHERE status = 'published'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Anon can read for web event pages
DO $$ BEGIN
  CREATE POLICY "eaf_anon_read" ON public.event_activity_feed FOR SELECT TO anon
    USING (event_id IN (SELECT id FROM public.events WHERE status = 'published' AND (privacy = 'public' OR privacy = 'invite')));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- User can delete own comments
DO $$ BEGIN
  CREATE POLICY "eaf_delete_own" ON public.event_activity_feed FOR DELETE TO authenticated
    USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "eaf_service_role" ON public.event_activity_feed FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

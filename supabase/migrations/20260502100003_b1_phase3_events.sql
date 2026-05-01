-- Cycle B1 Phase 3 — Events (BUSINESS_PROJECT_PLAN §B.3).
-- Tables: events, event_dates. Distinct from consumer experiences.

CREATE TABLE IF NOT EXISTS public.events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands (id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES auth.users (id),
  title text NOT NULL,
  description text,
  slug text NOT NULL,
  location_text text,
  location_geo point,
  online_url text,
  is_online boolean NOT NULL DEFAULT false,
  is_recurring boolean NOT NULL DEFAULT false,
  is_multi_date boolean NOT NULL DEFAULT false,
  recurrence_rules jsonb,
  cover_media_url text,
  cover_media_type text
    CONSTRAINT events_cover_media_type_check
      CHECK (cover_media_type IS NULL OR cover_media_type IN ('image', 'video', 'gif')),
  theme jsonb NOT NULL DEFAULT '{}'::jsonb,
  organiser_contact jsonb NOT NULL DEFAULT '{}'::jsonb,
  visibility text NOT NULL DEFAULT 'draft'
    CONSTRAINT events_visibility_check
      CHECK (visibility IN ('public', 'discover', 'private', 'hidden', 'draft')),
  show_on_discover boolean NOT NULL DEFAULT false,
  show_in_swipeable_deck boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'draft'
    CONSTRAINT events_status_check
      CHECK (status IN ('draft', 'scheduled', 'live', 'ended', 'cancelled')),
  published_at timestamptz,
  timezone text NOT NULL DEFAULT 'UTC',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT events_slug_nonempty CHECK (length(trim(slug)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_events_brand_slug_active
  ON public.events (brand_id, lower(slug))
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_events_brand_id
  ON public.events (brand_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_events_brand_status
  ON public.events (brand_id, status)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_events_published_at
  ON public.events (published_at)
  WHERE deleted_at IS NULL AND published_at IS NOT NULL;

DROP TRIGGER IF EXISTS trg_events_updated_at ON public.events;
CREATE TRIGGER trg_events_updated_at
  BEFORE UPDATE ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.biz_prevent_event_brand_id_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.brand_id IS DISTINCT FROM OLD.brand_id THEN
    RAISE EXCEPTION 'events.brand_id is immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_events_immutable_brand_id ON public.events;
CREATE TRIGGER trg_events_immutable_brand_id
  BEFORE UPDATE ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.biz_prevent_event_brand_id_change();

COMMENT ON TABLE public.events IS 'Mingla Business event (B1 §B.3). Not consumer experiences.';

ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.event_dates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events (id) ON DELETE CASCADE,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  timezone text NOT NULL DEFAULT 'UTC',
  is_master boolean NOT NULL DEFAULT false,
  override_title text,
  override_description text,
  override_location text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_dates_end_after_start CHECK (end_at > start_at)
);

CREATE INDEX IF NOT EXISTS idx_event_dates_event_id ON public.event_dates (event_id);
CREATE INDEX IF NOT EXISTS idx_event_dates_start_at ON public.event_dates (start_at);

DROP TRIGGER IF EXISTS trg_event_dates_updated_at ON public.event_dates;
CREATE TRIGGER trg_event_dates_updated_at
  BEFORE UPDATE ON public.event_dates
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.biz_prevent_event_dates_event_id_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.event_id IS DISTINCT FROM OLD.event_id THEN
    RAISE EXCEPTION 'event_dates.event_id is immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_event_dates_immutable_event_id ON public.event_dates;
CREATE TRIGGER trg_event_dates_immutable_event_id
  BEFORE UPDATE ON public.event_dates
  FOR EACH ROW
  EXECUTE FUNCTION public.biz_prevent_event_dates_event_id_change();

COMMENT ON TABLE public.event_dates IS 'Per-date rows for multi-date / recurring events (B1 §B.3).';

ALTER TABLE public.event_dates ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Helpers (SECURITY DEFINER; avoid RLS recursion)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.biz_event_brand_id(p_event_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT e.brand_id
  FROM public.events e
  WHERE e.id = p_event_id
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.biz_is_event_manager_plus(p_event_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.biz_brand_effective_rank(public.biz_event_brand_id(p_event_id), p_user_id)
    >= public.biz_role_rank('event_manager'::text);
$$;

-- ---------------------------------------------------------------------------
-- RLS: events (team read; event_manager+ write)
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Brand team can select events" ON public.events;
CREATE POLICY "Brand team can select events"
  ON public.events
  FOR SELECT
  TO authenticated
  USING (
    deleted_at IS NULL
    AND public.biz_is_brand_member_for_read(brand_id, auth.uid())
  );

DROP POLICY IF EXISTS "Event manager plus can insert events" ON public.events;
CREATE POLICY "Event manager plus can insert events"
  ON public.events
  FOR INSERT
  TO authenticated
  WITH CHECK (
    deleted_at IS NULL
    AND created_by = auth.uid()
    AND public.biz_brand_effective_rank(brand_id, auth.uid())
      >= public.biz_role_rank('event_manager'::text)
  );

DROP POLICY IF EXISTS "Event manager plus can update events" ON public.events;
CREATE POLICY "Event manager plus can update events"
  ON public.events
  FOR UPDATE
  TO authenticated
  USING (
    public.biz_brand_effective_rank(brand_id, auth.uid())
      >= public.biz_role_rank('event_manager'::text)
  )
  WITH CHECK (
    public.biz_brand_effective_rank(brand_id, auth.uid())
      >= public.biz_role_rank('event_manager'::text)
  );

DROP POLICY IF EXISTS "Event manager plus can delete events" ON public.events;
CREATE POLICY "Event manager plus can delete events"
  ON public.events
  FOR DELETE
  TO authenticated
  USING (
    public.biz_brand_effective_rank(brand_id, auth.uid())
      >= public.biz_role_rank('event_manager'::text)
  );

-- ---------------------------------------------------------------------------
-- RLS: event_dates (inherit event access)
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Brand team can select event_dates" ON public.event_dates;
CREATE POLICY "Brand team can select event_dates"
  ON public.event_dates
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.events e
      WHERE e.id = event_dates.event_id
        AND e.deleted_at IS NULL
        AND public.biz_is_brand_member_for_read(e.brand_id, auth.uid())
    )
  );

DROP POLICY IF EXISTS "Event manager plus can insert event_dates" ON public.event_dates;
CREATE POLICY "Event manager plus can insert event_dates"
  ON public.event_dates
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.biz_is_event_manager_plus(event_id, auth.uid())
  );

DROP POLICY IF EXISTS "Event manager plus can update event_dates" ON public.event_dates;
CREATE POLICY "Event manager plus can update event_dates"
  ON public.event_dates
  FOR UPDATE
  TO authenticated
  USING (public.biz_is_event_manager_plus(event_id, auth.uid()))
  WITH CHECK (public.biz_is_event_manager_plus(event_id, auth.uid()));

DROP POLICY IF EXISTS "Event manager plus can delete event_dates" ON public.event_dates;
CREATE POLICY "Event manager plus can delete event_dates"
  ON public.event_dates
  FOR DELETE
  TO authenticated
  USING (public.biz_is_event_manager_plus(event_id, auth.uid()));

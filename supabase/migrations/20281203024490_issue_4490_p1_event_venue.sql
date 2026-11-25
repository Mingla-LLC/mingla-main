-- #4490 P1 migration 3 — events and experiences can sit in a venue and space.
--
-- Columns only in P1 (spec 01 §3.1 "Events link"):
--   events.venue_id  -> venue_listings (ON DELETE SET NULL)
--   events.space_id  -> venue_spaces   (ON DELETE SET NULL; needs a venue)
--   events.space_use  'shared' | 'exclusive' (stored in P1; P4 enforces exclusive)
-- A trigger keeps the link inside the event's own brand and the space inside
-- the linked venue, and clears the space when the venue link goes (so a venue
-- delete never trips the CHECK). Writer: issue_4490_set_event_venue (brand rank
-- >= event_manager on the event's brand). Existing events are untouched (all
-- three columns default to "no venue", "shared").
--
-- Conflicts raise PT409 (never 40001). Static SQL. Local stack only until Seth
-- says otherwise.

BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.events
  ADD COLUMN venue_id uuid NULL REFERENCES public.venue_listings(id) ON DELETE SET NULL,
  ADD COLUMN space_id uuid NULL REFERENCES public.venue_spaces(id) ON DELETE SET NULL,
  ADD COLUMN space_use text NOT NULL DEFAULT 'shared'
    CONSTRAINT events_space_use_check CHECK (space_use IN ('shared', 'exclusive')),
  ADD CONSTRAINT events_space_needs_venue CHECK (space_id IS NULL OR venue_id IS NOT NULL);
CREATE INDEX events_venue_id_idx ON public.events (venue_id) WHERE venue_id IS NOT NULL;
COMMENT ON COLUMN public.events.venue_id IS
  '#4490: the venue this event or experience happens at (same brand). NULL = no venue link; venue text in theme stays as it was.';
COMMENT ON COLUMN public.events.space_id IS
  '#4490: the space of venue_id it uses. Cleared whenever venue_id is cleared.';
COMMENT ON COLUMN public.events.space_use IS
  '#4490: shared (other bookings may use the space) or exclusive (stored in P1; enforced from P4).';

CREATE OR REPLACE FUNCTION public.issue_4490_assert_event_venue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NEW.venue_id IS NULL THEN
    NEW.space_id := NULL;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.venue_id IS NOT DISTINCT FROM OLD.venue_id
     AND NEW.space_id IS NOT DISTINCT FROM OLD.space_id
     AND NEW.brand_id IS NOT DISTINCT FROM OLD.brand_id THEN
    RETURN NEW;
  END IF;
  IF NEW.brand_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.venue_listings venue
    WHERE venue.id = NEW.venue_id AND venue.brand_id = NEW.brand_id
  ) THEN
    RAISE EXCEPTION 'event_venue_brand_mismatch' USING ERRCODE = '23514';
  END IF;
  IF NEW.space_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.venue_spaces space
    WHERE space.id = NEW.space_id AND space.venue_id = NEW.venue_id
  ) THEN
    RAISE EXCEPTION 'event_space_not_in_venue' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER issue_4490_events_venue_link
  BEFORE INSERT OR UPDATE OF venue_id, space_id, brand_id ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.issue_4490_assert_event_venue();

CREATE OR REPLACE FUNCTION public.issue_4490_set_event_venue(
  p_event_id uuid,
  p_venue_id uuid,
  p_space_id uuid,
  p_space_use text DEFAULT 'shared',
  p_expected_updated_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_event record;
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  SELECT e.id, e.brand_id, e.updated_at, e.deleted_at INTO v_event
  FROM public.events e WHERE e.id = p_event_id
  FOR UPDATE;
  IF NOT FOUND OR v_event.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'event_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_event.brand_id IS NULL
     OR public.biz_brand_effective_rank_for_caller(v_event.brand_id) < public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF p_expected_updated_at IS NOT NULL AND p_expected_updated_at IS DISTINCT FROM v_event.updated_at THEN
    RAISE EXCEPTION 'stale_write' USING ERRCODE = 'PT409';
  END IF;
  IF COALESCE(p_space_use, '') NOT IN ('shared', 'exclusive') THEN
    RAISE EXCEPTION 'event_space_use_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_space_id IS NOT NULL AND p_venue_id IS NULL THEN
    RAISE EXCEPTION 'event_space_needs_venue' USING ERRCODE = '22023';
  END IF;
  IF p_venue_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.venue_listings venue
    WHERE venue.id = p_venue_id AND venue.brand_id = v_event.brand_id
  ) THEN
    RAISE EXCEPTION 'event_venue_brand_mismatch' USING ERRCODE = '22023';
  END IF;
  IF p_space_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.venue_spaces space
    WHERE space.id = p_space_id AND space.venue_id = p_venue_id
      AND space.is_active AND space.archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'event_space_not_in_venue' USING ERRCODE = '22023';
  END IF;

  UPDATE public.events
     SET venue_id = p_venue_id,
         space_id = p_space_id,
         space_use = CASE WHEN p_venue_id IS NULL THEN 'shared' ELSE p_space_use END
   WHERE id = p_event_id
  RETURNING jsonb_build_object(
    'event_id', id,
    'venue_id', venue_id,
    'space_id', space_id,
    'space_use', space_use,
    'updated_at', updated_at
  ) INTO v_result;
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_4490_assert_event_venue() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_4490_set_event_venue(uuid, uuid, uuid, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4490_set_event_venue(uuid, uuid, uuid, text, timestamptz) TO authenticated;

COMMIT;

-- Reverse (local use only; forward-fix in production):
--   DROP FUNCTION public.issue_4490_set_event_venue(uuid, uuid, uuid, text, timestamptz);
--   DROP TRIGGER issue_4490_events_venue_link ON public.events; DROP FUNCTION public.issue_4490_assert_event_venue();
--   DROP INDEX public.events_venue_id_idx;
--   ALTER TABLE public.events DROP CONSTRAINT events_space_needs_venue, DROP COLUMN space_use, DROP COLUMN space_id, DROP COLUMN venue_id;

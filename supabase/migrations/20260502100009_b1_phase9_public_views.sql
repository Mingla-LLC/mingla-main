-- Cycle B1 Phase 9 — Public reads (BUSINESS_PROJECT_PLAN §B.8) + grants.
-- Uses RLS on base tables for anon; views use security_invoker so policies apply.

-- Anon can read published public events (for share pages / mingla-web).
DROP POLICY IF EXISTS "Anon can read published public events" ON public.events;
CREATE POLICY "Anon can read published public events"
  ON public.events
  FOR SELECT
  TO anon
  USING (
    deleted_at IS NULL
    AND visibility = 'public'
    AND status IN ('scheduled', 'live')
  );

-- Brands that have at least one live public event (limits draft-only brands).
DROP POLICY IF EXISTS "Anon can read brands with public events" ON public.brands;
CREATE POLICY "Anon can read brands with public events"
  ON public.brands
  FOR SELECT
  TO anon
  USING (
    deleted_at IS NULL
    AND EXISTS (
      SELECT 1
      FROM public.events e
      WHERE e.brand_id = brands.id
        AND e.deleted_at IS NULL
        AND e.visibility = 'public'
        AND e.status IN ('scheduled', 'live')
    )
  );

-- Organiser profile: only accounts that have a brand with a public live event.
DROP POLICY IF EXISTS "Anon can read organiser public profiles" ON public.creator_accounts;
CREATE POLICY "Anon can read organiser public profiles"
  ON public.creator_accounts
  FOR SELECT
  TO anon
  USING (
    deleted_at IS NULL
    AND EXISTS (
      SELECT 1
      FROM public.brands b
      WHERE b.account_id = creator_accounts.id
        AND b.deleted_at IS NULL
        AND EXISTS (
          SELECT 1
          FROM public.events e
          WHERE e.brand_id = b.id
            AND e.deleted_at IS NULL
            AND e.visibility = 'public'
            AND e.status IN ('scheduled', 'live')
        )
    )
  );

-- Public event dates (schedules on share pages).
DROP POLICY IF EXISTS "Anon can read dates for public events" ON public.event_dates;
CREATE POLICY "Anon can read dates for public events"
  ON public.event_dates
  FOR SELECT
  TO anon
  USING (
    EXISTS (
      SELECT 1
      FROM public.events e
      WHERE e.id = event_dates.event_id
        AND e.deleted_at IS NULL
        AND e.visibility = 'public'
        AND e.status IN ('scheduled', 'live')
    )
  );

-- Ticket types visible for published public events (pricing on public pages).
DROP POLICY IF EXISTS "Anon can read ticket types for public events" ON public.ticket_types;
CREATE POLICY "Anon can read ticket types for public events"
  ON public.ticket_types
  FOR SELECT
  TO anon
  USING (
    deleted_at IS NULL
    AND is_hidden IS NOT TRUE
    AND is_disabled IS NOT TRUE
    AND EXISTS (
      SELECT 1
      FROM public.events e
      WHERE e.id = ticket_types.event_id
        AND e.deleted_at IS NULL
        AND e.visibility = 'public'
        AND e.status IN ('scheduled', 'live')
    )
  );

CREATE OR REPLACE VIEW public.events_public_view
WITH (security_invoker = true)
AS
SELECT
  id,
  brand_id,
  created_by,
  title,
  description,
  slug,
  location_text,
  location_geo,
  online_url,
  is_online,
  is_recurring,
  is_multi_date,
  recurrence_rules,
  cover_media_url,
  cover_media_type,
  theme,
  organiser_contact,
  visibility,
  show_on_discover,
  show_in_swipeable_deck,
  status,
  published_at,
  timezone,
  created_at,
  updated_at
FROM public.events
WHERE deleted_at IS NULL
  AND visibility = 'public'
  AND status IN ('scheduled', 'live');

CREATE OR REPLACE VIEW public.brands_public_view
WITH (security_invoker = true)
AS
SELECT
  b.id,
  b.account_id,
  b.name,
  b.slug,
  b.description,
  b.profile_photo_url,
  b.contact_email,
  b.contact_phone,
  b.social_links,
  b.custom_links,
  b.display_attendee_count,
  b.default_currency,
  b.created_at,
  b.updated_at
FROM public.brands b
WHERE b.deleted_at IS NULL
  AND EXISTS (
    SELECT 1
    FROM public.events e
    WHERE e.brand_id = b.id
      AND e.deleted_at IS NULL
      AND e.visibility = 'public'
      AND e.status IN ('scheduled', 'live')
  );

CREATE OR REPLACE VIEW public.organisers_public_view
WITH (security_invoker = true)
AS
SELECT
  id,
  display_name,
  avatar_url,
  business_name,
  created_at
FROM public.creator_accounts
WHERE deleted_at IS NULL;

COMMENT ON VIEW public.events_public_view IS 'Public published events (B1 §B.8); RLS via anon policies + view filter.';
COMMENT ON VIEW public.brands_public_view IS 'Brands with at least one public live event (B1 §B.8).';
COMMENT ON VIEW public.organisers_public_view IS 'Subset of creator_accounts for public organiser cards (B1 §B.8).';

GRANT SELECT ON public.events_public_view TO anon, authenticated;
GRANT SELECT ON public.brands_public_view TO anon, authenticated;
GRANT SELECT ON public.organisers_public_view TO anon, authenticated;

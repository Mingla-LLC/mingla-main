-- ORCH-0763D: runtime share/date/lifecycle repair.
--
-- Adds server-authoritative lifecycle actions for published business events and
-- keeps exact public URLs readable after cancellation/end so buyer-facing
-- unavailable states can render instead of 404ing.

CREATE OR REPLACE VIEW public.business_public_events_view
WITH (security_invoker = true) AS
SELECT
  e.id,
  e.brand_id,
  b.slug AS brand_slug,
  b.name AS brand_name,
  b.description AS brand_description,
  b.profile_photo_url AS brand_profile_photo_url,
  b.display_attendee_count AS brand_display_attendee_count,
  e.title,
  e.description,
  e.slug,
  e.location_text,
  e.online_url,
  e.is_online,
  e.is_recurring,
  e.is_multi_date,
  e.recurrence_rules,
  e.cover_media_url,
  e.cover_media_type,
  e.visibility,
  e.show_on_discover,
  e.status,
  e.published_at,
  e.timezone,
  e.created_at,
  e.updated_at,
  (e.theme - 'business_draft') AS public_theme
FROM public.events e
JOIN public.brands b ON b.id = e.brand_id
WHERE
  e.deleted_at IS NULL
  AND b.deleted_at IS NULL
  AND e.visibility = 'public'
  AND e.status IN ('scheduled', 'live', 'ended', 'cancelled');

GRANT SELECT ON public.business_public_events_view TO anon, authenticated, service_role;

COMMENT ON VIEW public.business_public_events_view IS
  'ORCH-0763D: public buyer-facing event read model. Includes cancelled/ended exact URLs so unavailable-state pages render while clients filter brand listings.';

DROP POLICY IF EXISTS "Public can read brands with public events (anon or authenticate" ON public.brands;
CREATE POLICY "Public can read brands with public events (anon or authenticate"
ON public.brands
FOR SELECT
TO authenticated, anon
USING (
  deleted_at IS NULL
  AND EXISTS (
    SELECT 1
    FROM public.events e
    WHERE e.brand_id = brands.id
      AND e.deleted_at IS NULL
      AND e.visibility = 'public'
      AND e.status = ANY (ARRAY['scheduled'::text, 'live'::text, 'ended'::text, 'cancelled'::text])
  )
);

DROP POLICY IF EXISTS "Public can read event dates for published events (anon or authe" ON public.event_dates;
CREATE POLICY "Public can read event dates for published events (anon or authe"
ON public.event_dates
FOR SELECT
TO authenticated, anon
USING (
  EXISTS (
    SELECT 1
    FROM public.events e
    WHERE e.id = event_dates.event_id
      AND e.deleted_at IS NULL
      AND e.visibility = 'public'
      AND e.status = ANY (ARRAY['scheduled'::text, 'live'::text, 'ended'::text, 'cancelled'::text])
  )
);

DROP POLICY IF EXISTS "Public can read organiser profiles for share pages (anon or aut" ON public.creator_accounts;
CREATE POLICY "Public can read organiser profiles for share pages (anon or aut"
ON public.creator_accounts
FOR SELECT
TO authenticated, anon
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
          AND e.status = ANY (ARRAY['scheduled'::text, 'live'::text, 'ended'::text, 'cancelled'::text])
      )
  )
);

DROP POLICY IF EXISTS "Public can read published events (anon or authenticated)" ON public.events;
CREATE POLICY "Public can read published events (anon or authenticated)"
ON public.events
FOR SELECT
TO authenticated, anon
USING (
  deleted_at IS NULL
  AND visibility = 'public'
  AND status = ANY (ARRAY['scheduled'::text, 'live'::text, 'ended'::text, 'cancelled'::text])
);

DROP POLICY IF EXISTS "Public can read ticket types for published events (anon or auth" ON public.ticket_types;
CREATE POLICY "Public can read ticket types for published events (anon or auth"
ON public.ticket_types
FOR SELECT
TO authenticated, anon
USING (
  deleted_at IS NULL
  AND is_hidden IS NOT TRUE
  AND EXISTS (
    SELECT 1
    FROM public.events e
    WHERE e.id = ticket_types.event_id
      AND e.deleted_at IS NULL
      AND e.visibility = 'public'
      AND e.status = ANY (ARRAY['scheduled'::text, 'live'::text, 'ended'::text, 'cancelled'::text])
  )
);

CREATE OR REPLACE FUNCTION public.business_cancel_event(
  p_event_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_user_id uuid;
  v_event public.events%ROWTYPE;
  v_brand record;
  v_now timestamptz := now();
  v_ticket_rows jsonb;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT *
  INTO v_event
  FROM public.events
  WHERE id = p_event_id
  FOR UPDATE;

  IF NOT FOUND OR v_event.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'event_not_found';
  END IF;

  IF v_event.status <> ALL (ARRAY['scheduled'::text, 'live'::text]) THEN
    RAISE EXCEPTION 'event_not_cancellable';
  END IF;

  IF public.biz_brand_effective_rank(v_event.brand_id, v_user_id) < public.biz_role_rank('event_manager'::text) THEN
    RAISE EXCEPTION 'insufficient_event_permission';
  END IF;

  SELECT id, slug, name
  INTO v_brand
  FROM public.brands
  WHERE id = v_event.brand_id
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'brand_not_found';
  END IF;

  UPDATE public.events
  SET status = 'cancelled',
      updated_at = v_now
  WHERE id = p_event_id
    AND status = ANY (ARRAY['scheduled'::text, 'live'::text])
    AND deleted_at IS NULL
  RETURNING * INTO v_event;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'event_not_cancellable';
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(tt) ORDER BY tt.display_order), '[]'::jsonb)
  INTO v_ticket_rows
  FROM public.ticket_types tt
  WHERE tt.event_id = p_event_id
    AND tt.deleted_at IS NULL;

  RETURN jsonb_build_object(
    'event', to_jsonb(v_event),
    'brand', jsonb_build_object(
      'id', v_brand.id,
      'slug', v_brand.slug,
      'name', v_brand.name
    ),
    'tickets', v_ticket_rows,
    'client_revision', NULL
  );
END;
$$;

REVOKE ALL ON FUNCTION public.business_cancel_event(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.business_cancel_event(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.business_cancel_event(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.business_cancel_event(uuid) IS
  'ORCH-0763D: server-authoritative event cancellation for scheduled/live business events, restricted to event_manager rank or above.';

CREATE OR REPLACE FUNCTION public.business_end_event_ticket_sales(
  p_event_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_user_id uuid;
  v_event public.events%ROWTYPE;
  v_brand record;
  v_now timestamptz := now();
  v_ticket_rows jsonb;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT *
  INTO v_event
  FROM public.events
  WHERE id = p_event_id
  FOR UPDATE;

  IF NOT FOUND OR v_event.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'event_not_found';
  END IF;

  IF v_event.status <> ALL (ARRAY['scheduled'::text, 'live'::text]) THEN
    RAISE EXCEPTION 'event_ticket_sales_not_closeable';
  END IF;

  IF public.biz_brand_effective_rank(v_event.brand_id, v_user_id) < public.biz_role_rank('event_manager'::text) THEN
    RAISE EXCEPTION 'insufficient_event_permission';
  END IF;

  SELECT id, slug, name
  INTO v_brand
  FROM public.brands
  WHERE id = v_event.brand_id
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'brand_not_found';
  END IF;

  UPDATE public.ticket_types
  SET sale_end_at = v_now,
      is_disabled = true,
      updated_at = v_now
  WHERE event_id = p_event_id
    AND deleted_at IS NULL
    AND is_hidden IS NOT TRUE
    AND available_online IS TRUE
    AND (
      sale_end_at IS NULL
      OR sale_end_at > v_now
      OR is_disabled IS NOT TRUE
    );

  UPDATE public.events
  SET updated_at = v_now
  WHERE id = p_event_id
  RETURNING * INTO v_event;

  SELECT COALESCE(jsonb_agg(to_jsonb(tt) ORDER BY tt.display_order), '[]'::jsonb)
  INTO v_ticket_rows
  FROM public.ticket_types tt
  WHERE tt.event_id = p_event_id
    AND tt.deleted_at IS NULL;

  RETURN jsonb_build_object(
    'event', to_jsonb(v_event),
    'brand', jsonb_build_object(
      'id', v_brand.id,
      'slug', v_brand.slug,
      'name', v_brand.name
    ),
    'tickets', v_ticket_rows,
    'client_revision', NULL
  );
END;
$$;

REVOKE ALL ON FUNCTION public.business_end_event_ticket_sales(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.business_end_event_ticket_sales(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.business_end_event_ticket_sales(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.business_end_event_ticket_sales(uuid) IS
  'ORCH-0763D: closes online ticket sales for a scheduled/live business event without marking the event itself ended.';

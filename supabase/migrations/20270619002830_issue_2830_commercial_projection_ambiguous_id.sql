-- #2830 — brand_site_commercial_projection threw on EVERY call.
--
-- Its RETURNS TABLE declares a column named `id`, which shadows brand_sites.id
-- inside its own lookup:
--
--   SELECT brand_id INTO STRICT v_brand_id FROM public.brand_sites WHERE id = p_site_id;
--                                                                        ^^ ambiguous
--
-- Postgres raises 42702 `column reference "id" is ambiguous` before the function
-- does any work. It was CREATED successfully and failed on every invocation.
--
-- THIRD OCCURRENCE OF THIS CLASS on this issue:
--   1. brand_site_orderable_venue      min(uuid) does not exist        (#3109)
--   2. brand_site_menu_projection      (fine — its columns don't collide)
--   3. brand_site_commercial_projection  ambiguous "id"                (here)
--
-- All three parsed, migrated, typechecked and passed every test, because every
-- test read the migration as TEXT and none of them EXECUTED it. Each was found
-- only by calling the function against real data.
--
-- Effect: any published page carrying a menu_board or an offering_grid made the
-- core projection endpoint return 409, the CMS recorded VALIDATION_FAILED, and
-- the publish failed closed. Gogi could not publish a Menu page at all.
--
-- Production already carries this fix, applied 2026-09-08 while unblocking the
-- pilot. This migration makes the repository match what is running.
--
-- Only the lookup is aliased. Every other line is byte-identical to what runs.
CREATE OR REPLACE FUNCTION public.brand_site_commercial_projection(p_site_id uuid, p_offering_ids uuid[])
 RETURNS TABLE(id uuid, kind text, title text, summary text, url text, checkout_url text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_brand_id uuid;
BEGIN
  SELECT bs.brand_id INTO STRICT v_brand_id FROM public.brand_sites bs WHERE bs.id = p_site_id;
  IF cardinality(p_offering_ids) > 20 OR array_position(p_offering_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'sites_validation_failed';
  END IF;
  RETURN QUERY
  SELECT event.id,
    CASE event.event_type
      WHEN 'trip' THEN 'offering'
      WHEN 'experience' THEN 'offering'
      ELSE 'offering'
    END,
    event.title,
    left(COALESCE(event.description, ''), 500),
    'https://host.usemingla.com/' ||
      CASE event.event_type WHEN 'trip' THEN 't/' WHEN 'experience' THEN 'exp/' ELSE 'e/' END ||
      brand.slug || '/' || event.slug,
    CASE WHEN event.event_type IN ('event','rsvp')
      THEN 'https://host.usemingla.com/checkout/' || event.id::text
      ELSE 'https://host.usemingla.com/' ||
        CASE event.event_type WHEN 'trip' THEN 't/' ELSE 'exp/' END ||
        brand.slug || '/' || event.slug
    END
  FROM public.events event
  JOIN public.brands brand ON brand.id = event.brand_id
  WHERE event.id = ANY(p_offering_ids)
    AND event.brand_id = v_brand_id
    AND event.deleted_at IS NULL
    AND event.visibility IN ('public','discover')
    AND event.status IN ('scheduled','live');
END;
$function$;

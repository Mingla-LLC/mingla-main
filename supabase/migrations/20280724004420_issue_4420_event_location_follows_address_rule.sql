-- =====================================================================================
-- Issue #4420 — an event's stored theme follows the address-visibility rule.
--
-- WHAT. While an event hides its address until booking (issue_2489_address_withheld:
-- hideAddressUntilTicket true or absent) and is not a draft, events.theme no longer
-- stores the exact location. These business_event keys move to a private table,
-- public.event_withheld_location, that app clients read only as the brand team, an
-- admin or a guest who booked:
--
--   business_event.location.address       the street
--   business_event.locationProviderPlaceId / location_provider_place_id   the map place
--   business_event.locationGeo / location_geo                              the pin
--   business_event.location_text                                           "<venue> · <street>"
--
-- A non-draft row also stops storing the host's business_draft blob (publish already
-- drops it; any leftover copy is kept in the private table, never shown).
-- The venue name, the city column, the hide flag and every other theme key stay.
--
-- HOW (one place, every writer). A BEFORE INSERT/UPDATE trigger on events does it, so
-- every writer is covered — the Host app, Ari, edge functions, RPCs, admin and direct
-- service-role writes — without changing any writer's payload:
--   * a write that names a key carries its value (null included);
--   * a write that omits a key on a row whose stored theme was already withheld keeps
--     the private value (the writer only ever saw the withheld theme);
--   * withheld and not a draft: the keys are stored privately and left out of theme;
--   * visible or a draft: theme carries the whole location (a host who shows the
--     address again, or unpublishes, gets the street back in theme).
-- Trips are untouched: their location model has no hide-until-ticket rule.
--
-- WHO READS THE EXACT LOCATION, AND HOW.
--   * The Host editor reads business_management_events_view.management_theme, which
--     now merges the private keys for the brand team, admins, booked guests and the
--     service role (issue_4420_event_theme_for_caller). Opening and saving a withheld
--     event therefore round-trips the street with no app change.
--   * Host RPC responses that return the event row (publish, live edit, cancel, end
--     sales, cover media, RSVP graph) return the merged theme through the same check.
--   * The writers that DERIVE something from the stored location read it merged:
--     business_update_live_event (the "<venue> · <street>" label when only the venue
--     changes), biz_update_live_rsvp, business_event_draft_payload_from_graph
--     (unpublish and duplicate), business_unpublish_rsvp_to_draft and the guest
--     edit-notice snapshot (so an address change still notifies booked guests).
--   * Booked guests, emails, check-in and the Explorer booked view read
--     events.location_text / location_geo, which this file does not change.
--   * Every public reader already projects issue_2489_public_theme; it now also drops
--     the place id, pin and label keys above while withheld (belt and braces).
--
-- Re-emitted functions are rewritten in place from their live definitions by exact,
-- counted substitutions (the #4174 pattern); CREATE OR REPLACE keeps each ACL. A count
-- mismatch aborts the migration.
--
-- ORDERING: strictly greater than 20280723004420 (the newest prefix in this worktree,
-- every sibling worktree and origin/main when this file was created).
-- =====================================================================================

BEGIN;

-- -------------------------------------------------------------------------------------
-- 1. The private store.
-- -------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.event_withheld_location (
  event_id uuid PRIMARY KEY
    REFERENCES public.events(id) ON DELETE CASCADE
    -- Deferred: the trigger writes this row while a new event row is still being
    -- inserted.
    DEFERRABLE INITIALLY DEFERRED,
  business_event jsonb NOT NULL DEFAULT '{}'::jsonb,
  business_draft jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_withheld_location_business_event_object
    CHECK (jsonb_typeof(business_event) = 'object')
);

COMMENT ON TABLE public.event_withheld_location IS
  '#4420 — the exact location keys of an event''s theme.business_event (street, map '
  'place id, pin, combined label) and any leftover host draft blob of a non-draft row. '
  'Written only by the issue_4420_withhold_event_location trigger. Readable by the brand '
  'team, admins, guests who booked and the service role; never by anon.';

ALTER TABLE public.event_withheld_location ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.event_withheld_location FROM PUBLIC;
REVOKE ALL ON TABLE public.event_withheld_location FROM anon;
REVOKE ALL ON TABLE public.event_withheld_location FROM authenticated;
GRANT SELECT ON TABLE public.event_withheld_location TO authenticated;
GRANT ALL ON TABLE public.event_withheld_location TO service_role;

-- -------------------------------------------------------------------------------------
-- 2. The rule's helpers.
-- -------------------------------------------------------------------------------------

-- The exact-location keys a business_event object carries (only those present).
CREATE OR REPLACE FUNCTION public.issue_4420_location_secret(p_business_event jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
  SELECT CASE
    WHEN pg_catalog.jsonb_typeof(p_business_event) IS DISTINCT FROM 'object' THEN '{}'::jsonb
    ELSE
      COALESCE((
        SELECT pg_catalog.jsonb_object_agg(k.key, p_business_event -> k.key)
          FROM pg_catalog.unnest(ARRAY['locationProviderPlaceId', 'location_provider_place_id',
                                       'locationGeo', 'location_geo', 'location_text']) AS k(key)
         WHERE p_business_event ? k.key), '{}'::jsonb)
      || CASE
           WHEN pg_catalog.jsonb_typeof(p_business_event -> 'location') = 'object'
            AND (p_business_event -> 'location') ? 'address'
             THEN pg_catalog.jsonb_build_object('location',
                    pg_catalog.jsonb_build_object('address', p_business_event #> '{location,address}'))
           ELSE '{}'::jsonb
         END
  END
$function$;

-- The business_event object without those keys. Pure; the public theme projection uses it.
CREATE OR REPLACE FUNCTION public.issue_4420_location_strip(p_business_event jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
  SELECT CASE
    WHEN pg_catalog.jsonb_typeof(p_business_event) IS DISTINCT FROM 'object' THEN p_business_event
    WHEN pg_catalog.jsonb_typeof(p_business_event -> 'location') = 'object'
      THEN (p_business_event - ARRAY['locationProviderPlaceId', 'location_provider_place_id',
                                     'locationGeo', 'location_geo', 'location_text'])
           #- '{location,address}'
    ELSE p_business_event - ARRAY['locationProviderPlaceId', 'location_provider_place_id',
                                  'locationGeo', 'location_geo', 'location_text']
  END
$function$;

-- The business_event object with each stored key it does not carry put back.
CREATE OR REPLACE FUNCTION public.issue_4420_location_restore(p_business_event jsonb, p_secret jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
DECLARE
  v_out jsonb := p_business_event;
  v_key text;
BEGIN
  IF pg_catalog.jsonb_typeof(p_business_event) IS DISTINCT FROM 'object'
     OR pg_catalog.jsonb_typeof(p_secret) IS DISTINCT FROM 'object' THEN
    RETURN p_business_event;
  END IF;
  FOR v_key IN SELECT pg_catalog.jsonb_object_keys(p_secret - 'location') LOOP
    IF NOT v_out ? v_key THEN
      v_out := v_out || pg_catalog.jsonb_build_object(v_key, p_secret -> v_key);
    END IF;
  END LOOP;
  IF pg_catalog.jsonb_typeof(p_secret -> 'location') = 'object' AND (p_secret -> 'location') ? 'address' THEN
    IF pg_catalog.jsonb_typeof(v_out -> 'location') = 'object' THEN
      IF NOT (v_out -> 'location') ? 'address' THEN
        v_out := pg_catalog.jsonb_set(v_out, '{location,address}', p_secret #> '{location,address}', true);
      END IF;
    ELSIF v_out -> 'location' IS NULL THEN
      v_out := v_out || pg_catalog.jsonb_build_object('location',
        pg_catalog.jsonb_build_object('address', p_secret #> '{location,address}'));
    END IF;
  END IF;
  RETURN v_out;
END
$function$;

-- The theme with the private keys merged back. No caller check: called only from
-- SECURITY DEFINER writers that already authorised the caller, and the trigger.
CREATE OR REPLACE FUNCTION public.issue_4420_event_theme_full(p_event_id uuid, p_theme jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT CASE
    WHEN pg_catalog.jsonb_typeof(p_theme -> 'business_event') = 'object' AND w.event_id IS NOT NULL
      THEN p_theme || pg_catalog.jsonb_build_object('business_event',
             public.issue_4420_location_restore(p_theme -> 'business_event', w.business_event))
    ELSE p_theme
  END
  FROM (SELECT 1) AS one
  LEFT JOIN public.event_withheld_location w ON w.event_id = p_event_id
$function$;

-- True when the caller may read an event's exact location: the service role, an admin,
-- the brand team or a guest who booked (issue_4420_caller_reads_exact_stops is the
-- same team-or-booked rule the hidden experience stops use).
CREATE OR REPLACE FUNCTION public.issue_4420_caller_reads_exact_location(p_event_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT COALESCE(auth.role(), '') = 'service_role'
      OR public.issue_4420_caller_reads_exact_stops(p_event_id)
      OR public.is_admin_user()
$function$;

-- The theme a caller may see: merged for the team, admins, booked guests and the
-- service role; as stored (withheld) for everyone else.
CREATE OR REPLACE FUNCTION public.issue_4420_event_theme_for_caller(p_event_id uuid, p_theme jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT CASE
    WHEN pg_catalog.jsonb_typeof(p_theme -> 'business_event') = 'object'
     AND EXISTS (SELECT 1 FROM public.event_withheld_location w WHERE w.event_id = p_event_id)
     AND public.issue_4420_caller_reads_exact_location(p_event_id)
      THEN public.issue_4420_event_theme_full(p_event_id, p_theme)
    ELSE p_theme
  END
$function$;

-- An event row as jsonb (to_jsonb(v_event)) with the caller's theme.
CREATE OR REPLACE FUNCTION public.issue_4420_event_json_for_caller(p_event jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT CASE
    WHEN pg_catalog.jsonb_typeof(p_event) = 'object' AND p_event ? 'theme'
     AND pg_catalog.jsonb_typeof(p_event -> 'id') = 'string'
      THEN p_event || pg_catalog.jsonb_build_object('theme',
             public.issue_4420_event_theme_for_caller((p_event ->> 'id')::uuid, p_event -> 'theme'))
    ELSE p_event
  END
$function$;

COMMENT ON FUNCTION public.issue_4420_location_secret(jsonb) IS
  '#4420 — the exact-location keys of a business_event object (street, place id, pin, label).';
COMMENT ON FUNCTION public.issue_4420_location_strip(jsonb) IS
  '#4420 — a business_event object without its exact-location keys.';
COMMENT ON FUNCTION public.issue_4420_location_restore(jsonb, jsonb) IS
  '#4420 — a business_event object with each stored exact-location key it lacks put back.';
COMMENT ON FUNCTION public.issue_4420_event_theme_full(uuid, jsonb) IS
  '#4420 — an event theme with its private location merged back. No caller check; only '
  'SECURITY DEFINER writers that already authorised the caller call it.';
COMMENT ON FUNCTION public.issue_4420_caller_reads_exact_location(uuid) IS
  '#4420 — the service role, an admin, the brand team or a guest who booked.';
COMMENT ON FUNCTION public.issue_4420_event_theme_for_caller(uuid, jsonb) IS
  '#4420 — an event theme merged with its private location for callers who may read it '
  '(issue_4420_caller_reads_exact_location); as stored for everyone else.';
COMMENT ON FUNCTION public.issue_4420_event_json_for_caller(jsonb) IS
  '#4420 — an event row (jsonb) with issue_4420_event_theme_for_caller applied to theme.';

REVOKE ALL ON FUNCTION public.issue_4420_location_secret(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_4420_location_restore(jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_4420_event_theme_full(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_4420_caller_reads_exact_location(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.issue_4420_event_theme_for_caller(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.issue_4420_event_json_for_caller(jsonb) FROM PUBLIC, anon;
-- Pure and reveals nothing; issue_2489_public_theme (granted to anon) calls it.
REVOKE ALL ON FUNCTION public.issue_4420_location_strip(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.issue_4420_location_strip(jsonb) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.issue_4420_location_secret(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_4420_location_restore(jsonb, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_4420_event_theme_full(uuid, jsonb) TO service_role;
-- authenticated: the management view runs with the caller's rights.
GRANT EXECUTE ON FUNCTION public.issue_4420_caller_reads_exact_location(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.issue_4420_event_theme_for_caller(uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.issue_4420_event_json_for_caller(jsonb) TO authenticated, service_role;

DROP POLICY IF EXISTS event_withheld_location_select_team_admin_or_booked ON public.event_withheld_location;
CREATE POLICY event_withheld_location_select_team_admin_or_booked ON public.event_withheld_location
  FOR SELECT TO authenticated
  USING (public.issue_4420_caller_reads_exact_stops(event_id) OR public.is_admin_user());

COMMENT ON POLICY event_withheld_location_select_team_admin_or_booked ON public.event_withheld_location IS
  '#4420 — the brand team, admins and guests who booked read an event''s exact location.';

-- -------------------------------------------------------------------------------------
-- 3. The trigger.
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4420_withhold_event_location()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_theme jsonb := NEW.theme;
  v_be jsonb;
  v_stored public.event_withheld_location%ROWTYPE;
  v_has_stored boolean := false;
  v_secret jsonb;
  v_draft jsonb;
  v_old_withheld boolean := false;
BEGIN
  IF NEW.event_type = 'trip' OR pg_catalog.jsonb_typeof(v_theme) IS DISTINCT FROM 'object' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_stored FROM public.event_withheld_location w WHERE w.event_id = NEW.id;
  v_has_stored := FOUND;
  v_draft := CASE WHEN v_has_stored THEN v_stored.business_draft END;

  -- A non-draft row never stores the host's draft blob.
  IF NEW.status IS DISTINCT FROM 'draft' AND v_theme ? 'business_draft' THEN
    v_draft := v_theme -> 'business_draft';
    v_theme := v_theme - 'business_draft';
  END IF;

  IF pg_catalog.jsonb_typeof(v_theme -> 'business_event') = 'object' THEN
    v_be := v_theme -> 'business_event';
    -- The stored theme was withheld: the writer never saw these keys, so a key it
    -- omits keeps the private value.
    IF TG_OP = 'UPDATE' THEN
      v_old_withheld := OLD.event_type IS DISTINCT FROM 'trip'
        AND OLD.status IS DISTINCT FROM 'draft'
        AND public.issue_2489_address_withheld(OLD.theme);
    END IF;
    IF v_old_withheld AND v_has_stored THEN
      v_be := public.issue_4420_location_restore(v_be, v_stored.business_event);
    END IF;
    v_secret := public.issue_4420_location_secret(v_be);

    IF NEW.status IS DISTINCT FROM 'draft' AND public.issue_2489_address_withheld(v_theme) THEN
      v_be := public.issue_4420_location_strip(v_be);
    END IF;
    v_theme := v_theme || pg_catalog.jsonb_build_object('business_event', v_be);
  ELSE
    -- No business_event object: nothing to withhold; keep what is stored.
    v_secret := CASE WHEN v_has_stored THEN v_stored.business_event ELSE '{}'::jsonb END;
  END IF;

  IF v_has_stored THEN
    IF v_stored.business_event IS DISTINCT FROM v_secret
       OR v_stored.business_draft IS DISTINCT FROM v_draft THEN
      UPDATE public.event_withheld_location
         SET business_event = v_secret, business_draft = v_draft, updated_at = pg_catalog.now()
       WHERE event_id = NEW.id;
    END IF;
  ELSIF v_secret <> '{}'::jsonb OR v_draft IS NOT NULL THEN
    INSERT INTO public.event_withheld_location(event_id, business_event, business_draft)
      VALUES (NEW.id, v_secret, v_draft);
  END IF;

  IF v_theme IS DISTINCT FROM NEW.theme THEN
    NEW.theme := v_theme;
  END IF;
  RETURN NEW;
END
$function$;

COMMENT ON FUNCTION public.issue_4420_withhold_event_location() IS
  '#4420 — keeps an event''s exact location (street, map place id, pin, label) and any '
  'non-draft host draft blob out of events.theme while the address is withheld, storing '
  'them in event_withheld_location. Visible or draft rows carry the whole location.';

REVOKE ALL ON FUNCTION public.issue_4420_withhold_event_location() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS issue_4420_withhold_event_location ON public.events;
-- Named so it runs after issue_3827_capture_edit_notice (which snapshots the stored
-- row) and after the other theme-reading BEFORE triggers that sort before it.
CREATE TRIGGER issue_4420_withhold_event_location
  BEFORE INSERT OR UPDATE OF theme, status, event_type ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.issue_4420_withhold_event_location();

-- -------------------------------------------------------------------------------------
-- 4. The public theme projection also drops the place id, pin and label keys.
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_2489_public_theme(p_theme jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
  SELECT CASE
    WHEN p_theme IS NULL THEN NULL
    WHEN pg_catalog.jsonb_typeof(p_theme) IS DISTINCT FROM 'object' THEN '{}'::jsonb
    WHEN public.issue_2489_address_withheld(p_theme) THEN
      -- #4420: an experience's venue_text is its first stop's street (written at
      -- publish), so it is withheld with the address. `#-` on a missing path is
      -- a no-op, so a theme without experience_meta is unchanged.
      -- #4420 (20280724004420): the street, map place id, pin and combined label
      -- leave business_event together (issue_4420_location_strip).
      CASE WHEN pg_catalog.jsonb_typeof(p_theme -> 'business_event') = 'object'
             THEN ((p_theme - 'business_draft')
                   || pg_catalog.jsonb_build_object('business_event',
                        public.issue_4420_location_strip(p_theme -> 'business_event')))
                  #- '{experience_meta,venue_text}'
           ELSE (p_theme - 'business_draft') #- '{experience_meta,venue_text}'
      END
    ELSE (p_theme - 'business_draft')
  END
$function$
;
GRANT EXECUTE ON FUNCTION public.issue_2489_public_theme(jsonb) TO anon, authenticated, service_role;

-- -------------------------------------------------------------------------------------
-- 5. The Host editor's read: the management view merges the private keys for callers
--    who may read them (the view runs with the caller's rights).
-- -------------------------------------------------------------------------------------
DO $view$
DECLARE
  v_def text := pg_catalog.pg_get_viewdef('public.business_management_events_view'::regclass);
  v_old text := $o$(e.theme - 'business_draft'::text) AS management_theme$o$;
  v_new text := $n$(issue_4420_event_theme_for_caller(e.id, e.theme) - 'business_draft'::text) AS management_theme$n$;
  v_old_count integer;
  v_new_count integer;
  v_comment text := pg_catalog.obj_description('public.business_management_events_view'::regclass, 'pg_class');
BEGIN
  v_old_count := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  v_new_count := (length(v_def) - length(replace(v_def, v_new, ''))) / length(v_new);
  IF v_new_count = 1 THEN
    RETURN;
  END IF;
  IF v_old_count <> 1 THEN
    RAISE EXCEPTION 'issue_4420_shape_mismatch: business_management_events_view expected 1 management_theme, found %', v_old_count;
  END IF;
  EXECUTE 'CREATE OR REPLACE VIEW public.business_management_events_view WITH (security_invoker = true) AS '
    || replace(v_def, v_old, v_new);
  IF v_comment IS NOT NULL THEN
    EXECUTE format('COMMENT ON VIEW public.business_management_events_view IS %L',
      v_comment || ' #4420: management_theme merges the private location for the team, admins, booked guests and the service role.');
  END IF;
END
$view$;

-- -------------------------------------------------------------------------------------
-- 6. Exact, counted in-place rewrites of live definitions. A pattern that already shows
--    its replacement counts as applied (each replacement contains its original, so the
--    replacement is checked first).
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp.issue_4420_loc_patch(
  p_signature text,
  p_old text,
  p_new text,
  p_expected integer
) RETURNS void
LANGUAGE plpgsql
AS $function$
DECLARE
  v_def text;
  v_old_count integer;
  v_new_count integer;
BEGIN
  v_def := pg_get_functiondef(p_signature::regprocedure);
  v_new_count := (length(v_def) - length(replace(v_def, p_new, ''))) / length(p_new);
  IF v_new_count = p_expected THEN
    RETURN;
  END IF;
  v_old_count := (length(v_def) - length(replace(v_def, p_old, ''))) / length(p_old);
  IF v_old_count <> p_expected THEN
    RAISE EXCEPTION 'issue_4420_shape_mismatch: % expected % match(es), found %',
      p_signature, p_expected, v_old_count;
  END IF;
  EXECUTE replace(v_def, p_old, p_new);
END
$function$;

-- 6a. Writers that derive something from the stored location read it merged.
SELECT pg_temp.issue_4420_loc_patch(
  'public.business_update_live_event(uuid,jsonb,text,integer)',
  $o$SELECT * INTO v_event FROM public.events WHERE id=p_event_id FOR UPDATE;$o$,
  $n$SELECT * INTO v_event FROM public.events WHERE id=p_event_id FOR UPDATE;
  v_event.theme:=public.issue_4420_event_theme_full(v_event.id,v_event.theme);  -- #4420$n$,
  1);

SELECT pg_temp.issue_4420_loc_patch(
  'public.biz_update_live_rsvp(uuid,jsonb,text)',
  $o$v_theme := COALESCE(v_existing.theme, '{}'::jsonb);$o$,
  $n$v_theme := COALESCE(public.issue_4420_event_theme_full(v_existing.id, v_existing.theme), '{}'::jsonb);  -- #4420$n$,
  1);

SELECT pg_temp.issue_4420_loc_patch(
  'public.business_event_draft_payload_from_graph(uuid)',
  $o$v_business := COALESCE(v_event.theme->'business_draft', v_event.theme->'business_event', '{}'::jsonb)$o$,
  $n$v_business := COALESCE(v_event.theme->'business_draft', public.issue_4420_event_theme_full(v_event.id, v_event.theme)->'business_event', '{}'::jsonb)$n$,
  1);

SELECT pg_temp.issue_4420_loc_patch(
  'public.business_unpublish_rsvp_to_draft(uuid)',
  $o$v_draft:=COALESCE(v_event.theme->'business_event','{}'::jsonb)||$o$,
  $n$v_draft:=COALESCE(public.issue_4420_event_theme_full(v_event.id,v_event.theme)->'business_event','{}'::jsonb)||$n$,
  1);

SELECT pg_temp.issue_4420_loc_patch(
  'public.business_event_notice_snapshot(uuid)',
  $o$SELECT e.event_type, e.timezone, e.location_text, e.online_url, e.theme
    INTO v_type, v_timezone, v_label, v_online, v_theme$o$,
  $n$SELECT e.event_type, e.timezone, e.location_text, e.online_url, public.issue_4420_event_theme_full(e.id, e.theme)
    INTO v_type, v_timezone, v_label, v_online, v_theme$n$,
  1);

-- 6b. Host RPC responses return the event row with the caller's theme.
DO $responses$
DECLARE
  v_sig text;
BEGIN
  FOREACH v_sig IN ARRAY ARRAY[
    'public.business_publish_event_draft(uuid,jsonb,integer)',
    'public.business_publish_rsvp_draft(uuid,jsonb,integer)',
    'public.business_update_live_event(uuid,jsonb,text,integer)',
    'public.business_update_live_event_atomic(uuid,jsonb,text,integer)',
    'public.biz_update_live_rsvp(uuid,jsonb,text)',
    'public.business_cancel_event(uuid)',
    'public.business_end_event_ticket_sales(uuid)',
    'public.business_set_event_cover_media(uuid,text,text,text,text,text,text,text,text,text)',
    'public.business_clear_event_cover_media(uuid)',
    'public.issue_1977_rsvp_graph(uuid)'
  ] LOOP
    PERFORM pg_temp.issue_4420_loc_patch(
      v_sig,
      'to_jsonb(v_event)',
      'public.issue_4420_event_json_for_caller(to_jsonb(v_event))',
      1);
  END LOOP;
END
$responses$;

-- -------------------------------------------------------------------------------------
-- 7. Existing rows: move the exact location (and any non-draft draft blob) out of theme.
--    The trigger does the work; status is unchanged, so no publish guard fires, and the
--    edit-notice capture does not fire because theme is unchanged when it is checked.
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4420_backfill_event_withheld_location()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.events e
     SET theme = e.theme
   WHERE e.event_type IS DISTINCT FROM 'trip'
     AND e.status IS DISTINCT FROM 'draft'
     AND pg_catalog.jsonb_typeof(e.theme) = 'object'
     AND (e.theme ? 'business_draft'
          OR (public.issue_2489_address_withheld(e.theme)
              AND public.issue_4420_location_secret(e.theme -> 'business_event') <> '{}'::jsonb));
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END
$function$;

COMMENT ON FUNCTION public.issue_4420_backfill_event_withheld_location() IS
  '#4420 — moves a withheld event''s exact location and any non-draft draft blob out of '
  'events.theme into event_withheld_location. Idempotent; run once by 20280724004420.';

REVOKE ALL ON FUNCTION public.issue_4420_backfill_event_withheld_location() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4420_backfill_event_withheld_location() TO service_role;

DO $backfill$
DECLARE
  v_count integer;
BEGIN
  v_count := public.issue_4420_backfill_event_withheld_location();
  RAISE NOTICE '#4420: % event theme(s) moved their exact location to event_withheld_location', v_count;
END
$backfill$;

-- #2489 SC-25: every object that carries the shared address gate is declared.
INSERT INTO public.issue_2489_gate_carriers (object_name, object_kind) VALUES
  ('issue_4420_withhold_event_location', 'function'),
  ('issue_4420_backfill_event_withheld_location', 'function')
ON CONFLICT (object_name) DO NOTHING;

COMMIT;

-- -------------------------------------------------------------------------------------
-- 8. Post-apply self-check (committed state).
-- -------------------------------------------------------------------------------------
DO $verify$
BEGIN
  IF has_table_privilege('anon', 'public.event_withheld_location', 'SELECT') THEN
    RAISE EXCEPTION '#4420 FAILED: anon can read event_withheld_location';
  END IF;
  IF has_function_privilege('anon', 'public.issue_4420_event_theme_full(uuid,jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.issue_4420_event_theme_full(uuid,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION '#4420 FAILED: app clients can call issue_4420_event_theme_full';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.events e
     WHERE e.event_type IS DISTINCT FROM 'trip'
       AND e.status IS DISTINCT FROM 'draft'
       AND pg_catalog.jsonb_typeof(e.theme) = 'object'
       AND (e.theme ? 'business_draft'
            OR (public.issue_2489_address_withheld(e.theme)
                AND public.issue_4420_location_secret(e.theme -> 'business_event') <> '{}'::jsonb))) THEN
    RAISE EXCEPTION '#4420 FAILED: a withheld event theme still stores its exact location';
  END IF;
  RAISE NOTICE '#4420 VERIFIED: withheld event themes store no exact location; the private store is closed to anon';
END
$verify$;

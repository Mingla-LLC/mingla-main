-- #4490 gap list 07-D: menu ordering mode (N46).
-- Number note: spec 07 reserved 284490 for C+D; round 1 takes the next free
-- number in the reserved range (conductor ruling), so D is 274490.
--
-- venue_ordering_settings.table_service_enabled (default true). The mode is
-- derived from the two switches: At the table = (true,false), Collect at the
-- counter = (false,true), Both = (true,true); at least one is always on.
-- biz_venue_ordering_set_mode writes both switches in one statement.
-- pg_public_venue_ordering_state returns table_service_enabled + order_mode.
-- venue-order-create (edge) places a scanned order as a counter order when
-- table service is off, or when the guest chose pickup in Both.

ALTER TABLE public.venue_ordering_settings
  ADD COLUMN IF NOT EXISTS table_service_enabled boolean NOT NULL DEFAULT true;

ALTER TABLE public.venue_ordering_settings
  DROP CONSTRAINT IF EXISTS venue_ordering_settings_some_mode;
ALTER TABLE public.venue_ordering_settings
  ADD CONSTRAINT venue_ordering_settings_some_mode
  CHECK (table_service_enabled OR counter_pickup_enabled);

COMMENT ON COLUMN public.venue_ordering_settings.table_service_enabled IS
  '#4490 07-D: a scanned table spot orders to the table. false = every order is a counter order (pickup code, name). Mode is derived with counter_pickup_enabled; at least one is on.';

CREATE OR REPLACE FUNCTION public.biz_venue_ordering_set_mode(
  p_venue_id uuid,
  p_mode     text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_brand uuid;
  v_uid   uuid := auth.uid();
  v_table boolean;
  v_counter boolean;
  v_row   public.venue_ordering_settings%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF p_mode IS NULL OR p_mode NOT IN ('table', 'counter', 'both') THEN
    RAISE EXCEPTION 'order_mode_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT brand_id INTO v_brand FROM public.venue_listings WHERE id = p_venue_id;
  IF v_brand IS NULL THEN
    RAISE EXCEPTION 'venue_not_found' USING ERRCODE = 'P0002';
  END IF;
  -- Same gate as biz_venue_ordering_set_enabled (event manager and up), plus
  -- finance managers and staff with venue.manage_money / venue.manage_offers (05).
  IF NOT (
    public.biz_brand_effective_rank_for_caller(v_brand) >= public.biz_role_rank('event_manager')
    OR public.issue_4490_can_manage_money(p_venue_id, v_uid)
    OR public.issue_4490_can_manage_venue(p_venue_id, 'venue.manage_offers')
  ) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  v_table := p_mode IN ('table', 'both');
  v_counter := p_mode IN ('counter', 'both');

  INSERT INTO public.venue_ordering_settings (venue_id, brand_id, table_service_enabled, counter_pickup_enabled)
  VALUES (p_venue_id, v_brand, v_table, v_counter)
  ON CONFLICT (venue_id) DO UPDATE
    SET table_service_enabled = EXCLUDED.table_service_enabled,
        counter_pickup_enabled = EXCLUDED.counter_pickup_enabled
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'venueId', p_venue_id,
    'orderMode', p_mode,
    'tableServiceEnabled', v_row.table_service_enabled,
    'counterPickupEnabled', v_row.counter_pickup_enabled
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.biz_venue_ordering_set_mode(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.biz_venue_ordering_set_mode(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.pg_public_venue_ordering_state(
  p_brand_slug text,
  p_venue_slug text,
  p_spot_code  text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_venue_id   uuid;
  v_brand_id   uuid;
  v_venue_name text;
  v_settings   public.venue_ordering_settings%ROWTYPE;
  v_state      text;
  v_spot_state text := 'none';
  v_spot       jsonb := NULL;
  v_label      text;
  v_kind       text;
  v_menu       uuid;
BEGIN
  IF p_brand_slug IS NULL OR p_venue_slug IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('state', 'unavailable', 'spot_state', 'none');
  END IF;

  -- The SAME public gate `venue_public_view` and `public_menus_view` apply:
  -- verified claim, live brand. A venue that is not public here is not
  -- orderable anywhere, and says so in the same words.
  SELECT v.id, v.brand_id, v.name
    INTO v_venue_id, v_brand_id, v_venue_name
    FROM public.venue_listings v
    JOIN public.brands b
      ON b.id = v.brand_id
     AND b.deleted_at IS NULL
   WHERE b.slug = p_brand_slug
     AND v.slug = p_venue_slug
     AND v.claim_status = 'verified'
   LIMIT 1;

  IF v_venue_id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('state', 'unavailable', 'spot_state', 'none');
  END IF;

  SELECT * INTO v_settings
    FROM public.venue_ordering_settings
   WHERE venue_id = v_venue_id;

  IF NOT FOUND OR v_settings.ordering_enabled IS NOT TRUE THEN
    v_state := 'off';
  ELSIF v_settings.paused_at IS NOT NULL THEN
    v_state := 'paused';
  ELSE
    v_state := 'on';
  END IF;

  -- The spot arm. Resolved even when the venue is paused or off, because
  -- "Table 12 — ordering is paused right now" is the honest state and
  -- "this code isn't active" would be a lie about a code that is.
  IF p_spot_code IS NOT NULL AND pg_catalog.btrim(p_spot_code) <> '' THEN
    SELECT s.label, s.kind, s.serving_menu_id
      INTO v_label, v_kind, v_menu
      FROM public.qr_spots s
     WHERE s.code = pg_catalog.btrim(p_spot_code)
       AND s.is_active
       AND s.brand_id = v_brand_id
       -- D-3b: a room spot orders from its SERVING venue's kitchen, and the
       -- printed URL points at that venue's page. A code whose serving venue is
       -- not the page being read is not this page's code.
       AND s.serving_venue_id = v_venue_id
     LIMIT 1;
    -- FOUND, never `v_label IS NULL`: `qr_spots.label` is NULLABLE, so a real
    -- unlabelled spot would otherwise be reported to its own guest as a code
    -- that does not exist.
    IF NOT FOUND THEN
      v_spot_state := 'unknown';
    ELSE
      v_spot_state := 'ok';
      v_spot := pg_catalog.jsonb_build_object(
        'label',           v_label,
        'kind',            v_kind,
        'serving_menu_id', v_menu
      );
    END IF;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'state',                  v_state,
    'venue_id',               v_venue_id,
    'venue_name',             v_venue_name,
    'spot_state',             v_spot_state,
    'spot',                   v_spot,
    -- D-9 / P-19 — the venue's own service charge. Returned so the guest can be
    -- TOLD about it before they commit to a cart; the MONEY still comes from
    -- venue-order-create, which is the only thing that may compute it (P-20).
    'service_charge_bps',     COALESCE(v_settings.service_charge_bps, 0),
    'service_charge_label',   COALESCE(v_settings.service_charge_label, 'Service charge'),
    -- D-2 / P-18 — tips. Where a service charge is set, the guest surface
    -- defaults the tip to NONE rather than stacking; the flag and the presets
    -- are what let it render that without guessing.
    'tips_enabled',           COALESCE(v_settings.tips_enabled, false),
    'tip_presets_bps',        v_settings.tip_presets_bps,
    -- D-3a — counter pickup: may a guest with no scanned spot order at all?
    'counter_pickup_enabled', COALESCE(v_settings.counter_pickup_enabled, false),
    -- #4490 07-D — may a scanned spot order to the table? Mode is derived from
    -- the two switches, never stored twice: table | counter | both.
    'table_service_enabled',  COALESCE(v_settings.table_service_enabled, true),
    'order_mode',             CASE
                                WHEN COALESCE(v_settings.table_service_enabled, true)
                                     AND COALESCE(v_settings.counter_pickup_enabled, false) THEN 'both'
                                WHEN COALESCE(v_settings.table_service_enabled, true) THEN 'table'
                                ELSE 'counter'
                              END,
    'prep_time_minutes',      v_settings.prep_time_minutes
  );
END;
$function$;


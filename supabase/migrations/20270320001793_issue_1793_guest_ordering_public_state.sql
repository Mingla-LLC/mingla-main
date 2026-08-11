-- ===========================================================================
-- Issue #1793 — #1767 Phase 4 (GUEST ORDERING ON): the honest public read.
--
-- SPEC #1788 P-9 / P-22 gate 3, and the ORCHESTRATOR AMENDMENT registered
-- against THIS phase on #1789:
--
--   "P-9 (public spot resolver returns NULL when ordering is disabled) is
--    fail-closed and correct as built ... Fail-closed stays at the money
--    boundary, not the read. Honest reads + fail-closed writes is the house
--    pattern. Amendment registered against Phase 4 (#1793): when the guest
--    surface exists, a paused venue must show an honest 'ordering is paused
--    here' state rather than a card that reads as broken."
--
-- `pg_public_qr_spot_resolve` is deliberately UNCHANGED — it is green, pinned,
-- and its fail-closed NULL is the right answer for a resolver whose job is to
-- hand a guest a menu. But NULL is also the answer for an unknown code, a
-- deleted spot, an unverified venue and a paused one, and a guest surface that
-- can only see NULL has exactly one thing it can render: a broken card.
--
-- So Phase 4 adds a SECOND, read-only resolver that distinguishes the four
-- states a guest can honestly be told about, and NOTHING here relaxes a money
-- gate: `venue-order-create` still applies P-22 gates 1-3 against the tables
-- themselves before a single row is written. This function cannot create,
-- price, or authorise anything. It answers one question — "can I order here
-- right now, and if not, why not?" — and the four answers are the four the
-- guest copy needs.
--
-- WHAT IT DELIBERATELY DOES NOT EXPOSE: no `qr_spots.id`, no `venue_orders`
-- anything, no brand internals, no ids a guest could enumerate. `venue_id` is
-- returned because `venue_public_view` already publishes it to anon (it is what
-- a counter-pickup order-create must send when there is no spot code), so this
-- adds no reachable surface. The venue's own configured charges ARE returned,
-- because a guest is about to be charged them and
-- I-PROPOSED-1767-EVERY-CHARGE-IS-VISIBLE says they may never be hidden.
--
-- NO TABLE IS CREATED and NO GRANT IS WIDENED here (cf. #1856): the only
-- privilege this migration issues is EXECUTE on one STABLE, SECURITY DEFINER,
-- read-only function, revoked from PUBLIC first.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The four honest states.
--
--   'unavailable' — no such public venue (unknown slugs, unverified claim, or a
--                   deleted brand). Same answer the rest of the public surface
--                   already gives; ordering adds no new oracle.
--   'off'         — a real, verified, public venue that has not switched Mingla
--                   ordering on. The default for every venue in the world.
--   'paused'      — switched ON, and the venue has paused it themselves. This
--                   is the state the amendment exists for. D-7b: the pause
--                   switch is THEIRS; Mingla never writes it.
--   'on'          — orderable right now.
--
-- The spot arm is independent, because a printed code and the venue's switch
-- fail for different reasons and a guest deserves to know which:
--   spot_state 'none'    — no code was presented (counter pickup / venue page).
--   spot_state 'ok'      — active code, serving THIS venue.
--   spot_state 'unknown' — no such active code, or a code that serves a
--                          different venue's kitchen. Collapsed on purpose:
--                          telling the two apart would say which codes exist.
-- ---------------------------------------------------------------------------
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
    'prep_time_minutes',      v_settings.prep_time_minutes
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.pg_public_venue_ordering_state(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pg_public_venue_ordering_state(text, text, text)
  TO anon, authenticated;

COMMENT ON FUNCTION public.pg_public_venue_ordering_state(text, text, text) IS
  'Issue #1793 (SPEC #1788 P-9/P-22 amendment, registered against Phase 4 on '
  '#1789): the guest-facing HONEST read of a venue''s ordering state. '
  'pg_public_qr_spot_resolve stays fail-closed and returns NULL for anything '
  'unknown, inactive, unverified, paused or disabled — which is correct for a '
  'resolver but leaves a guest surface with nothing to render but a broken '
  'card. This distinguishes on / paused / off / unavailable, and resolves a '
  'printed spot code even while the venue is paused, so a guest at a paused '
  'venue is told the truth instead of being shown a failure. It creates '
  'nothing, prices nothing and authorises nothing: every money gate still runs '
  'inside venue-order-create (P-22 gates 1-3, P-20).';

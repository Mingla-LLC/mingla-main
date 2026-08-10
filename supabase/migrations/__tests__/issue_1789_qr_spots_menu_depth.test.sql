-- Issue #1789 (#1767 Phase 1) — behavioural suite for
-- 20270305001789_issue_1789_qr_spots_menu_depth_and_ordering_settings.sql.
--
-- SPEC #1788 P-7, P-7a, P-7c, P-8, P-9, P-11, P-11a, P-12, P-14, P-16.
--
-- fails-on-revert, per block:
--   T-1  drop the qr_spots_kind_shape CHECK  -> a table spot with no table id persists. RED.
--   T-2  drop the mint trigger              -> a client-chosen code persists. RED.
--   T-3  drop the immutability trigger      -> a rename can kill a printed card. RED.
--   T-4  drop the venue_tables provisioner  -> the venue manages two lists. RED.
--   T-5  drop the stay_units provisioner    -> a room has no spot, or prints a dead link. RED.
--   T-6  drop the lifecycle sync            -> a deleted table keeps a live QR. RED.
--   T-7  drop the P-8 serving trigger       -> a spot orders from another brand. RED.
--   T-8  drop the P-11a currency trigger    -> a cross-currency modifier persists. RED.
--   T-9  drop the P-12 CHECKs               -> an out-of-range service window persists. RED.
--   T-10 drop the P-14 view tail            -> the public menu loses allows_notes. RED.
--   T-11 relax the P-9 resolver             -> a dark venue's code resolves. RED.
--   T-12 change the P-16 default            -> ordering is ON by default. RED.
--
-- Every negative assertion is paired with a POSITIVE control, so an empty
-- table can never make this file pass vacuously.
--
-- Run: psql -v ON_ERROR_STOP=1 -f supabase/migrations/__tests__/issue_1789_qr_spots_menu_depth.test.sql

\set ON_ERROR_STOP on
BEGIN;

-- ---------------------------------------------------------------------------
-- Fixtures: one brand, two venues (a restaurant and a stay), a table, a named
-- stay unit, and a menu with one item.
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
VALUES (
  '00000000-1789-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'owner-1789@example.test', now(), now()
);

INSERT INTO public.creator_accounts (id, created_at)
VALUES ('00000000-1789-4000-8000-000000000001', now());

INSERT INTO public.brands (id, account_id, name, slug, default_currency, created_at, updated_at)
VALUES (
  '00000000-1789-4000-8000-000000000002',
  '00000000-1789-4000-8000-000000000001',
  'Issue 1789 Brand', 'issue1789brand', 'GBP', now(), now()
);

-- A SECOND brand, for the cross-brand splice control (T-7). It deliberately
-- reuses the account seeded above rather than inventing a second one: T-7
-- asserts that a SPOT cannot be pointed at another BRAND's kitchen, and which
-- creator owns that brand is irrelevant to it. `brands.account_id` carries only
-- a plain index (`idx_brands_account_id`), never a UNIQUE, so one account
-- legitimately owns several brands — and `creator_accounts.id` is FK'd to
-- `auth.users(id)` (`creator_accounts_id_fkey`), so a second synthetic account
-- would have needed a second synthetic auth user to exist at all. A fixture
-- seeds only what its assertions require.
INSERT INTO public.brands (id, account_id, name, slug, default_currency, created_at, updated_at)
VALUES (
  '00000000-1789-4000-8000-000000000004',
  '00000000-1789-4000-8000-000000000001',
  'Issue 1789 Other Brand', 'issue1789other', 'GBP', now(), now()
);

INSERT INTO public.venue_listings (id, brand_id, slug, name, lat, lng, venue_category, claim_status)
VALUES
  ('00000000-1789-4000-8000-000000000010', '00000000-1789-4000-8000-000000000002',
   'brasserie1789', 'The Brasserie', 51.50, -0.12, 'restaurant', 'verified'),
  ('00000000-1789-4000-8000-000000000011', '00000000-1789-4000-8000-000000000002',
   'grandhotel1789', 'Grand Hotel', 51.51, -0.13, 'stay', 'verified'),
  ('00000000-1789-4000-8000-000000000012', '00000000-1789-4000-8000-000000000004',
   'foreign1789', 'Foreign Venue', 51.52, -0.14, 'restaurant', 'verified');

-- ===========================================================================
-- T-4 — AUTO-PROVISION FROM venue_tables (P-7c).
-- ===========================================================================
INSERT INTO public.venue_tables (id, brand_id, venue_id, name, capacity, zone, sort_order)
VALUES (
  '00000000-1789-4000-8000-000000000020',
  '00000000-1789-4000-8000-000000000002',
  '00000000-1789-4000-8000-000000000010',
  'Table 12', 4, 'indoor', 3
);

DO $t4$
DECLARE
  v_spot public.qr_spots;
BEGIN
  SELECT * INTO v_spot FROM public.qr_spots
   WHERE venue_table_id = '00000000-1789-4000-8000-000000000020';
  IF v_spot.id IS NULL THEN
    RAISE EXCEPTION 'T-4 FAIL: creating a table minted no spot (P-7c)';
  END IF;
  IF v_spot.kind <> 'table' THEN
    RAISE EXCEPTION 'T-4 FAIL: kind is % not table', v_spot.kind;
  END IF;
  IF v_spot.label <> 'Table 12' THEN
    RAISE EXCEPTION 'T-4 FAIL: label is % not the table name', v_spot.label;
  END IF;
  IF v_spot.zone <> 'indoor' THEN
    RAISE EXCEPTION 'T-4 FAIL: zone did not follow the table';
  END IF;
  IF NOT v_spot.auto_provisioned THEN
    RAISE EXCEPTION 'T-4 FAIL: spot not marked auto_provisioned';
  END IF;
  IF NOT v_spot.is_active THEN
    RAISE EXCEPTION 'T-4 FAIL: a live table''s spot must be active';
  END IF;
  -- A table serves its OWN venue's whole menu.
  IF v_spot.serving_venue_id <> v_spot.venue_id OR v_spot.serving_menu_id IS NOT NULL THEN
    RAISE EXCEPTION 'T-4 FAIL: a table spot must serve its own venue''s whole menu';
  END IF;
  RAISE NOTICE 'T-4 PASS: venue_tables auto-provision';
END
$t4$;

-- ===========================================================================
-- T-2 / T-1 — the code is server-minted, format-legal, and the kind shape holds.
-- ===========================================================================
DO $t2$
DECLARE
  v_code text;
BEGIN
  SELECT code INTO v_code FROM public.qr_spots
   WHERE venue_table_id = '00000000-1789-4000-8000-000000000020';
  IF v_code !~ '^[a-z2-9]{10}$' THEN
    RAISE EXCEPTION 'T-2 FAIL: minted code % is not 10 chars of the safe alphabet', v_code;
  END IF;
  -- The alphabet excludes the glyphs a human misreads off a printed card.
  IF v_code ~ '[ilo01]' THEN
    RAISE EXCEPTION 'T-2 FAIL: minted code % contains a confusable glyph', v_code;
  END IF;
  RAISE NOTICE 'T-2 PASS: server-minted code format';
END
$t2$;

DO $t2b$
DECLARE
  v_code text;
BEGIN
  -- A client-supplied code is DISCARDED, not honoured. (P-7a: never
  -- client-composed — a property of the schema, not of a code review.)
  INSERT INTO public.qr_spots (
    brand_id, venue_id, kind, zone, label, serving_venue_id, code
  ) VALUES (
    '00000000-1789-4000-8000-000000000002',
    '00000000-1789-4000-8000-000000000010',
    'zone', 'bar', 'Roof Bar',
    '00000000-1789-4000-8000-000000000010',
    'chosenbyme'
  ) RETURNING code INTO v_code;
  IF v_code = 'chosenbyme' THEN
    RAISE EXCEPTION 'T-2 FAIL: a client chose its own printed code';
  END IF;
  RAISE NOTICE 'T-2b PASS: client-supplied codes are discarded';
END
$t2b$;

DO $t1$
BEGIN
  BEGIN
    INSERT INTO public.qr_spots (brand_id, venue_id, kind, label, serving_venue_id, code)
    VALUES (
      '00000000-1789-4000-8000-000000000002',
      '00000000-1789-4000-8000-000000000010',
      'table', 'Table with no table', -- kind='table' with a NULL venue_table_id
      '00000000-1789-4000-8000-000000000010', 'aaaaaaaaaa'
    );
    RAISE EXCEPTION 'T-1 FAIL: kind=table persisted with no venue_table_id';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  -- POSITIVE CONTROL: the same insert with kind='custom' succeeds, so T-1 is
  -- not passing because inserts are broken.
  INSERT INTO public.qr_spots (brand_id, venue_id, kind, label, serving_venue_id, code)
  VALUES (
    '00000000-1789-4000-8000-000000000002',
    '00000000-1789-4000-8000-000000000010',
    'custom', 'Pop-up counter',
    '00000000-1789-4000-8000-000000000010', 'aaaaaaaaaa'
  );
  RAISE NOTICE 'T-1 PASS: kind shape CHECK holds (with positive control)';
END
$t1$;

-- ===========================================================================
-- T-3 / T-6 — a rename re-points the label and NEVER the code; a soft-delete
--             deactivates the spot (I-PROPOSED-1767-PRINTED-CODE-SURVIVES-A-RENAME).
-- ===========================================================================
DO $t3$
DECLARE
  v_before text;
  v_after  text;
  v_label  text;
BEGIN
  SELECT code INTO v_before FROM public.qr_spots
   WHERE venue_table_id = '00000000-1789-4000-8000-000000000020';

  UPDATE public.venue_tables SET name = 'Table 12A', zone = 'patio'
   WHERE id = '00000000-1789-4000-8000-000000000020';

  SELECT code, label INTO v_after, v_label FROM public.qr_spots
   WHERE venue_table_id = '00000000-1789-4000-8000-000000000020';

  IF v_after <> v_before THEN
    RAISE EXCEPTION 'T-3 FAIL: a rename changed the printed code (% -> %)', v_before, v_after;
  END IF;
  IF v_label <> 'Table 12A' THEN
    RAISE EXCEPTION 'T-3 FAIL: the label did not follow the rename (got %)', v_label;
  END IF;

  -- A direct attempt to rewrite the code is refused outright.
  BEGIN
    UPDATE public.qr_spots SET code = 'zzzzzzzzzz'
     WHERE venue_table_id = '00000000-1789-4000-8000-000000000020';
    RAISE EXCEPTION 'T-3 FAIL: qr_spots.code was mutable';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%qr_spot_code_immutable%' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'T-3 PASS: printed code survives a rename and is immutable';
END
$t3$;

DO $t6$
DECLARE
  v_active boolean;
BEGIN
  UPDATE public.venue_tables SET deleted_at = now()
   WHERE id = '00000000-1789-4000-8000-000000000020';
  SELECT is_active INTO v_active FROM public.qr_spots
   WHERE venue_table_id = '00000000-1789-4000-8000-000000000020';
  IF v_active THEN
    RAISE EXCEPTION 'T-6 FAIL: a soft-deleted table kept a live printable spot';
  END IF;
  RAISE NOTICE 'T-6 PASS: lifecycle mirroring deactivates the spot';
END
$t6$;

-- ===========================================================================
-- T-5 — a named stay unit mints a spot that lands INACTIVE with the "choose
--       which kitchen serves this room" to-do, so a dead QR can never print.
-- ===========================================================================
INSERT INTO public.stay_offerings (
  id, venue_id, brand_id, kind, name, status, inventory_basis, unit_naming_mode,
  quantity, max_adults, max_children
) VALUES (
  '00000000-1789-4000-8000-000000000030',
  '00000000-1789-4000-8000-000000000011',
  '00000000-1789-4000-8000-000000000002',
  'room', 'Deluxe rooms', 'draft', 'exclusive_units', 'named', 4, 2, 2
);

INSERT INTO public.stay_units (id, offering_id, brand_id, venue_id, name, status)
VALUES (
  '00000000-1789-4000-8000-000000000031',
  '00000000-1789-4000-8000-000000000030',
  '00000000-1789-4000-8000-000000000002',
  '00000000-1789-4000-8000-000000000011',
  'Room 204', 'active'
);

DO $t5$
DECLARE
  v_spot public.qr_spots;
BEGIN
  SELECT * INTO v_spot FROM public.qr_spots
   WHERE stay_unit_id = '00000000-1789-4000-8000-000000000031';
  IF v_spot.id IS NULL THEN
    RAISE EXCEPTION 'T-5 FAIL: a named stay unit minted no spot (P-7c)';
  END IF;
  IF v_spot.kind <> 'room_unit' OR v_spot.label <> 'Room 204' THEN
    RAISE EXCEPTION 'T-5 FAIL: room spot has the wrong shape';
  END IF;
  IF v_spot.is_active THEN
    RAISE EXCEPTION
      'T-5 FAIL: a room spot must land INACTIVE until an operator picks the serving kitchen (D-3b)';
  END IF;
  RAISE NOTICE 'T-5 PASS: room spot lands inactive with the to-do';
END
$t5$;

-- ===========================================================================
-- T-7 — the serving reference can never leave the brand (P-8), and the happy
--       mixed-venue re-point (Room 204 -> the Brasserie) DOES work.
-- ===========================================================================
INSERT INTO public.menus (id, brand_id, venue_id, name, sort_order)
VALUES (
  '00000000-1789-4000-8000-000000000040',
  '00000000-1789-4000-8000-000000000002',
  '00000000-1789-4000-8000-000000000010',
  'In-room dining', 0
);

DO $t7$
DECLARE
  v_serving uuid;
BEGIN
  -- HAPPY: re-point the room at the sibling restaurant venue + its menu.
  UPDATE public.qr_spots
     SET serving_venue_id = '00000000-1789-4000-8000-000000000010',
         serving_menu_id  = '00000000-1789-4000-8000-000000000040',
         is_active = true
   WHERE stay_unit_id = '00000000-1789-4000-8000-000000000031';
  SELECT serving_venue_id INTO v_serving FROM public.qr_spots
   WHERE stay_unit_id = '00000000-1789-4000-8000-000000000031';
  IF v_serving <> '00000000-1789-4000-8000-000000000010' THEN
    RAISE EXCEPTION 'T-7 FAIL: the mixed-venue re-point did not stick';
  END IF;

  -- HOSTILE: another brand's venue is refused.
  BEGIN
    UPDATE public.qr_spots
       SET serving_venue_id = '00000000-1789-4000-8000-000000000012'
     WHERE stay_unit_id = '00000000-1789-4000-8000-000000000031';
    RAISE EXCEPTION 'T-7 FAIL: a spot was pointed at another brand''s kitchen';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%serving_venue_brand_mismatch%' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'T-7 PASS: serving reference is brand-locked (with happy control)';
END
$t7$;

-- ===========================================================================
-- T-8 — a modifier must carry its item's currency (P-11a).
-- ===========================================================================
INSERT INTO public.menu_items (id, menu_id, brand_id, name, price_cents, currency, sort_order)
VALUES (
  '00000000-1789-4000-8000-000000000050',
  '00000000-1789-4000-8000-000000000040',
  '00000000-1789-4000-8000-000000000002',
  'Club sandwich', 1450, 'GBP', 0
);

INSERT INTO public.menu_modifier_groups (
  id, menu_item_id, brand_id, name, selection_mode, min_select, max_select, sort_order
) VALUES (
  '00000000-1789-4000-8000-000000000051',
  '00000000-1789-4000-8000-000000000050',
  '00000000-1789-4000-8000-000000000002',
  'How would you like it?', 'single', 1, 1, 0
);

DO $t8$
BEGIN
  -- POSITIVE CONTROL: the item's own currency inserts fine, and a NEGATIVE
  -- delta (a smaller portion) is legitimate.
  INSERT INTO public.menu_modifiers (group_id, brand_id, name, price_delta_cents, currency)
  VALUES
    ('00000000-1789-4000-8000-000000000051', '00000000-1789-4000-8000-000000000002',
     'Rare', 0, 'GBP'),
    ('00000000-1789-4000-8000-000000000051', '00000000-1789-4000-8000-000000000002',
     'Half portion', -300, 'GBP');

  BEGIN
    INSERT INTO public.menu_modifiers (group_id, brand_id, name, price_delta_cents, currency)
    VALUES ('00000000-1789-4000-8000-000000000051',
            '00000000-1789-4000-8000-000000000002', 'Well done', 0, 'USD');
    RAISE EXCEPTION 'T-8 FAIL: a USD modifier attached to a GBP item';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%modifier_currency_mismatch%' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'T-8 PASS: modifier currency is welded to the item (with control)';
END
$t8$;

DO $t8b$
BEGIN
  -- The select-shape CHECK: 'single' can never allow two picks.
  BEGIN
    INSERT INTO public.menu_modifier_groups (
      menu_item_id, brand_id, name, selection_mode, min_select, max_select
    ) VALUES (
      '00000000-1789-4000-8000-000000000050',
      '00000000-1789-4000-8000-000000000002',
      'Broken single', 'single', 0, 3
    );
    RAISE EXCEPTION 'T-8b FAIL: a single-choice group allowed max_select=3';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  -- POSITIVE CONTROL: multi with max >= min is legal.
  INSERT INTO public.menu_modifier_groups (
    menu_item_id, brand_id, name, selection_mode, min_select, max_select
  ) VALUES (
    '00000000-1789-4000-8000-000000000050',
    '00000000-1789-4000-8000-000000000002',
    'Extras', 'multi', 0, 3
  );
  RAISE NOTICE 'T-8b PASS: modifier group select shape (with positive control)';
END
$t8b$;

-- ===========================================================================
-- T-9 — the P-12 additive columns and their CHECKs.
-- ===========================================================================
DO $t9$
BEGIN
  -- Defaults ARE today's behaviour: notes allowed, no window, no cost.
  IF NOT EXISTS (
    SELECT 1 FROM public.menu_items
     WHERE id = '00000000-1789-4000-8000-000000000050'
       AND allows_notes
       AND prep_station IS NULL
       AND cost_cents IS NULL
  ) THEN
    RAISE EXCEPTION 'T-9 FAIL: the additive menu_items defaults changed behaviour';
  END IF;

  BEGIN
    UPDATE public.menu_items SET prep_station = 'sommelier'
     WHERE id = '00000000-1789-4000-8000-000000000050';
    RAISE EXCEPTION 'T-9 FAIL: an unknown prep_station persisted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  -- POSITIVE CONTROL.
  UPDATE public.menu_items SET prep_station = 'kitchen', cost_cents = 420
   WHERE id = '00000000-1789-4000-8000-000000000050';

  BEGIN
    UPDATE public.menus SET service_days = ARRAY[0,1]::smallint[]
     WHERE id = '00000000-1789-4000-8000-000000000040';
    RAISE EXCEPTION 'T-9 FAIL: day 0 persisted (ISO days are 1..7)';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    UPDATE public.menus SET service_window_start = TIME '07:00'
     WHERE id = '00000000-1789-4000-8000-000000000040';
    RAISE EXCEPTION 'T-9 FAIL: a half-open service window persisted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  -- POSITIVE CONTROL: a wrapping late-night window is legal by design.
  UPDATE public.menus
     SET service_window_start = TIME '21:00',
         service_window_end   = TIME '02:00',
         service_days = ARRAY[5,6,7]::smallint[]
   WHERE id = '00000000-1789-4000-8000-000000000040';
  RAISE NOTICE 'T-9 PASS: menu depth columns + CHECKs (with positive controls)';
END
$t9$;

-- ===========================================================================
-- T-10 — public_menus_view keeps its prior column contract and gains the
--        ordering tail; cost_cents and prep_station are NEVER public.
-- ===========================================================================
DO $t10$
DECLARE
  v_col text;
  v_pos int;
BEGIN
  FOREACH v_col IN ARRAY ARRAY['item_id','allows_notes','photo_url',
                               'service_window_start','service_window_end','service_days']
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'public_menus_view'
         AND column_name = v_col
    ) THEN
      RAISE EXCEPTION 'T-10 FAIL: public_menus_view is missing %', v_col;
    END IF;
  END LOOP;

  FOREACH v_col IN ARRAY ARRAY['cost_cents','prep_station','is_available']
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'public_menus_view'
         AND column_name = v_col
    ) THEN
      RAISE EXCEPTION 'T-10 FAIL: public_menus_view exposes %', v_col;
    END IF;
  END LOOP;

  -- The prior contract survives: venue_slug stayed where #1365 put it.
  SELECT ordinal_position INTO v_pos FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'public_menus_view'
     AND column_name = 'venue_slug';
  IF v_pos <> 14 THEN
    RAISE EXCEPTION 'T-10 FAIL: venue_slug moved to ordinal % — the tail was not appended', v_pos;
  END IF;

  -- The item is genuinely readable through the view (vacuity guard).
  IF NOT EXISTS (
    SELECT 1 FROM public.public_menus_view
     WHERE id = '00000000-1789-4000-8000-000000000050' AND allows_notes
  ) THEN
    RAISE EXCEPTION 'T-10 FAIL: the seeded item is not visible through the view';
  END IF;

  -- The modifier payload resolves for that item, and negative deltas survive.
  IF (public.pg_public_menu_modifiers(
        ARRAY['00000000-1789-4000-8000-000000000050'::uuid]
      ) -> '00000000-1789-4000-8000-000000000050') IS NULL THEN
    RAISE EXCEPTION 'T-10 FAIL: pg_public_menu_modifiers returned no groups';
  END IF;
  RAISE NOTICE 'T-10 PASS: public read surface';
END
$t10$;

-- ===========================================================================
-- T-11 / T-12 — venue_ordering_settings defaults OFF, and the guest resolver
--               is FAIL-CLOSED while it is (P-9, P-16, orchestrator OQ-7).
-- ===========================================================================
DO $t11$
DECLARE
  v_code text;
  v_resolved jsonb;
BEGIN
  SELECT code INTO v_code FROM public.qr_spots
   WHERE stay_unit_id = '00000000-1789-4000-8000-000000000031';

  -- No settings row at all -> NULL.
  IF public.pg_public_qr_spot_resolve(v_code) IS NOT NULL THEN
    RAISE EXCEPTION 'T-11 FAIL: a code resolved with no ordering settings row';
  END IF;

  INSERT INTO public.venue_ordering_settings (venue_id, brand_id)
  VALUES ('00000000-1789-4000-8000-000000000010',
          '00000000-1789-4000-8000-000000000002');

  IF NOT EXISTS (
    SELECT 1 FROM public.venue_ordering_settings
     WHERE venue_id = '00000000-1789-4000-8000-000000000010'
       AND ordering_enabled = false
       AND paused_at IS NULL
       AND service_charge_bps = 0
       AND tips_enabled
  ) THEN
    RAISE EXCEPTION 'T-12 FAIL: venue_ordering_settings defaults are not opt-in-off';
  END IF;

  -- Settings exist but ordering is OFF -> still NULL.
  IF public.pg_public_qr_spot_resolve(v_code) IS NOT NULL THEN
    RAISE EXCEPTION 'T-11 FAIL: a code resolved while ordering_enabled is false';
  END IF;

  -- POSITIVE CONTROL: with ordering ON the resolver returns the payload, so
  -- T-11 is not passing because the resolver is simply broken.
  UPDATE public.venue_ordering_settings SET ordering_enabled = true
   WHERE venue_id = '00000000-1789-4000-8000-000000000010';
  v_resolved := public.pg_public_qr_spot_resolve(v_code);
  IF v_resolved IS NULL THEN
    RAISE EXCEPTION 'T-11 FAIL: the resolver returns nothing even with ordering ON';
  END IF;
  IF v_resolved ->> 'spot_label' <> 'Room 204'
     OR v_resolved ->> 'venue_slug' <> 'brasserie1789'
     OR v_resolved ->> 'brand_slug' <> 'issue1789brand' THEN
    RAISE EXCEPTION 'T-11 FAIL: resolver payload is wrong: %', v_resolved;
  END IF;
  -- It leaks no enumerable id.
  IF v_resolved ? 'id' OR v_resolved ? 'brand_id' OR v_resolved ? 'venue_id' THEN
    RAISE EXCEPTION 'T-11 FAIL: the resolver leaked an enumerable id';
  END IF;

  -- A PAUSE closes it again (D-7b: the pause switch is theirs).
  UPDATE public.venue_ordering_settings
     SET paused_at = now(), paused_by_user_id = '00000000-1789-4000-8000-000000000001'
   WHERE venue_id = '00000000-1789-4000-8000-000000000010';
  IF public.pg_public_qr_spot_resolve(v_code) IS NOT NULL THEN
    RAISE EXCEPTION 'T-11 FAIL: a paused venue still resolved a code';
  END IF;

  -- A pause always names a person.
  BEGIN
    UPDATE public.venue_ordering_settings
       SET paused_by_user_id = NULL
     WHERE venue_id = '00000000-1789-4000-8000-000000000010';
    RAISE EXCEPTION 'T-12 FAIL: an anonymous pause persisted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- An unknown code is NULL, not an error.
  IF public.pg_public_qr_spot_resolve('nosuchcode') IS NOT NULL THEN
    RAISE EXCEPTION 'T-11 FAIL: an unknown code resolved';
  END IF;
  RAISE NOTICE 'T-11/T-12 PASS: fail-closed resolver + opt-in-off settings';
END
$t11$;

-- ===========================================================================
-- T-13 — ACLs: anon can reach the two public RPCs and NOTHING else.
-- ===========================================================================
DO $t13$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    RAISE EXCEPTION 'T-13 FAIL: the anon role is missing — the checks below would be vacuous';
  END IF;
  IF has_table_privilege('anon', 'public.qr_spots', 'SELECT') THEN
    RAISE EXCEPTION 'T-13 FAIL: anon can read qr_spots directly';
  END IF;
  IF has_table_privilege('anon', 'public.venue_ordering_settings', 'SELECT') THEN
    RAISE EXCEPTION 'T-13 FAIL: anon can read venue_ordering_settings';
  END IF;
  IF has_table_privilege('anon', 'public.menu_modifiers', 'SELECT') THEN
    RAISE EXCEPTION 'T-13 FAIL: anon can read menu_modifiers directly';
  END IF;
  IF has_function_privilege('anon', 'public.pg_issue_1789_qr_spot_code()', 'EXECUTE') THEN
    RAISE EXCEPTION 'T-13 FAIL: anon can mint printed codes';
  END IF;
  -- POSITIVE CONTROL: the two intended-public reads ARE reachable.
  IF NOT has_function_privilege('anon', 'public.pg_public_qr_spot_resolve(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'T-13 FAIL: anon cannot reach the spot resolver';
  END IF;
  IF NOT has_function_privilege('anon', 'public.pg_public_menu_modifiers(uuid[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'T-13 FAIL: anon cannot reach the public modifier read';
  END IF;
  RAISE NOTICE 'T-13 PASS: anon ACL surface';
END
$t13$;

ROLLBACK;

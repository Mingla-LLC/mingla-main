-- ===========================================================================
-- Issue #1793 (#1767 Phase 4) — the HONEST public ordering state, executed
-- against the real applied schema.
--
-- The orchestrator amendment registered against this phase: a guest at a venue
-- whose ordering is switched off — or paused by the venue itself — must be able
-- to be told which, rather than shown a card that reads as broken. #1789's
-- `pg_public_qr_spot_resolve` answers NULL to every one of those cases (it is
-- fail-closed, correctly), so Phase 4 adds a read that can tell them apart.
--
-- What this file proves, behaviourally, as `anon`:
--
--   A. The four states are the four real states, and they move when the venue
--      moves them — off -> on -> paused -> on.
--   B. A printed code still RESOLVES while the venue is paused, so the guest is
--      told "Table 12, ordering is paused" instead of "this code isn't active".
--   C. It leaks nothing: no spot id, no order, no unverified venue, no other
--      brand's code, and the fail-closed resolver is UNCHANGED beside it.
--   D. It authorises nothing: it is STABLE, and no money gate moved.
--
-- Runs inside ONE transaction and ROLLBACKs — it leaves no rows.
-- ===========================================================================
BEGIN;

CREATE TEMP TABLE t1793_fx (k text PRIMARY KEY, v uuid);

DO $seed$
DECLARE
  v_brand    uuid := '00000000-1793-4000-8000-000000000002';
  v_venue    uuid := '00000000-1793-4000-8000-000000000010';
  v_other    uuid := '00000000-1793-4000-8000-000000000011';
  v_unverif  uuid := '00000000-1793-4000-8000-000000000012';
  v_table    uuid := '00000000-1793-4000-8000-000000000020';
  v_owner    uuid := '00000000-1793-4000-8000-000000000001';
  v_spot uuid;
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  VALUES (v_owner, '00000000-0000-0000-0000-000000000000', 'authenticated',
          'authenticated', 'owner-1793@example.test', now(), now());
  INSERT INTO public.creator_accounts (id, created_at) VALUES (v_owner, now());

  INSERT INTO public.brands (id, account_id, name, slug, default_currency,
                             payment_provider, created_at, updated_at)
  VALUES (v_brand, v_owner, 'Issue 1793 Brand', 'issue1793brand', 'GBP',
          'stripe', now(), now());

  INSERT INTO public.venue_listings (id, brand_id, slug, name, lat, lng,
                                     venue_category, claim_status)
  VALUES
    (v_venue,   v_brand, 'brasserie1793', 'The Brasserie', 51.50, -0.12,
     'restaurant', 'verified'),
    (v_other,   v_brand, 'roofbar1793',   'The Roof Bar',  51.51, -0.13,
     'restaurant', 'verified'),
    (v_unverif, v_brand, 'unclaimed1793', 'Not Yet Ours',  51.52, -0.14,
     'restaurant', 'unclaimed');

  INSERT INTO public.venue_tables (id, brand_id, venue_id, name, capacity, zone, sort_order)
  VALUES (v_table, v_brand, v_venue, 'Table 12', 4, 'indoor', 1);

  -- #1789's auto-provision trigger already minted this table's spot; ADOPT it
  -- rather than race it, exactly as every sibling fixture does.
  SELECT id INTO v_spot FROM public.qr_spots WHERE venue_table_id = v_table;
  IF v_spot IS NULL THEN
    INSERT INTO public.qr_spots (brand_id, venue_id, kind, venue_table_id, label,
                                 serving_venue_id, code)
    VALUES (v_brand, v_venue, 'table', v_table, 'Table 12', v_venue, 'kq7m3pd2xw')
    RETURNING id INTO v_spot;
  END IF;
  UPDATE public.qr_spots SET code = 'kq7m3pd2xw', label = 'Table 12'
   WHERE id = v_spot;

  INSERT INTO t1793_fx VALUES
    ('brand', v_brand), ('venue', v_venue), ('other', v_other),
    ('unverified', v_unverif), ('spot', v_spot), ('owner', v_owner);
END $seed$;

CREATE OR REPLACE FUNCTION pg_temp.state(p_spot text DEFAULT NULL) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT public.pg_public_venue_ordering_state(
           'issue1793brand', 'brasserie1793', p_spot)
$$;

CREATE OR REPLACE FUNCTION pg_temp.fx_venue() RETURNS uuid LANGUAGE sql STABLE
AS $$ SELECT v FROM t1793_fx WHERE k = 'venue' $$;
CREATE OR REPLACE FUNCTION pg_temp.fx_brand() RETURNS uuid LANGUAGE sql STABLE
AS $$ SELECT v FROM t1793_fx WHERE k = 'brand' $$;
CREATE OR REPLACE FUNCTION pg_temp.fx_owner() RETURNS uuid LANGUAGE sql STABLE
AS $$ SELECT v FROM t1793_fx WHERE k = 'owner' $$;
CREATE OR REPLACE FUNCTION pg_temp.fx_spot() RETURNS uuid LANGUAGE sql STABLE
AS $$ SELECT v FROM t1793_fx WHERE k = 'spot' $$;

-- ---------------------------------------------------------------------------
-- A. The four states are real, and they move when the venue moves them.
-- ---------------------------------------------------------------------------
DO $a$
DECLARE v jsonb;
BEGIN
  -- A1 — DEFAULT. Every venue in the world starts here: no settings row at all.
  DELETE FROM public.venue_ordering_settings WHERE venue_id = pg_temp.fx_venue();
  v := pg_temp.state();
  IF v->>'state' <> 'off' THEN
    RAISE EXCEPTION 'issue_1793 A1: a venue with no settings row must read `off`, got %', v->>'state';
  END IF;
  IF (v->>'venue_name') <> 'The Brasserie' THEN
    RAISE EXCEPTION 'issue_1793 A1: the venue must still be NAMED so the copy can say who';
  END IF;

  -- A2 — switched on.
  INSERT INTO public.venue_ordering_settings (venue_id, brand_id, ordering_enabled,
                                              service_charge_bps, service_charge_label,
                                              tips_enabled, counter_pickup_enabled)
  VALUES (pg_temp.fx_venue(), pg_temp.fx_brand(), true, 1250, 'Service', true, true)
  ON CONFLICT (venue_id) DO UPDATE
    SET ordering_enabled = true, paused_at = NULL, paused_by_user_id = NULL;
  v := pg_temp.state();
  IF v->>'state' <> 'on' THEN
    RAISE EXCEPTION 'issue_1793 A2: an enabled venue must read `on`, got %', v->>'state';
  END IF;
  -- D-9 / I-PROPOSED-1767-EVERY-CHARGE-IS-VISIBLE: a guest may be told what
  -- they are about to be charged BEFORE they commit to a basket.
  IF (v->>'service_charge_bps')::int <> 1250
     OR (v->>'service_charge_label') <> 'Service' THEN
    RAISE EXCEPTION 'issue_1793 A2: the venue''s own charge must be visible to the guest surface';
  END IF;
  IF (v->>'tips_enabled')::boolean IS NOT TRUE
     OR (v->>'counter_pickup_enabled')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'issue_1793 A2: the guest surface cannot render the tip row or the counter arm without these';
  END IF;

  -- A3 — THE AMENDMENT. The venue pauses itself; the guest is told SO.
  UPDATE public.venue_ordering_settings
     SET paused_at = now(), paused_by_user_id = pg_temp.fx_owner()
   WHERE venue_id = pg_temp.fx_venue();
  v := pg_temp.state();
  IF v->>'state' <> 'paused' THEN
    RAISE EXCEPTION 'issue_1793 A3: a paused venue must read `paused`, got % — a guest would see a broken card', v->>'state';
  END IF;

  -- A4 — and back.
  UPDATE public.venue_ordering_settings
     SET paused_at = NULL, paused_by_user_id = NULL
   WHERE venue_id = pg_temp.fx_venue();
  IF pg_temp.state()->>'state' <> 'on' THEN
    RAISE EXCEPTION 'issue_1793 A4: unpausing must restore `on`';
  END IF;

  -- A5 — an unknown venue, and an UNVERIFIED one, are the same honest answer.
  IF public.pg_public_venue_ordering_state('issue1793brand', 'nope', NULL)->>'state'
     <> 'unavailable' THEN
    RAISE EXCEPTION 'issue_1793 A5: an unknown venue must read `unavailable`';
  END IF;
  IF public.pg_public_venue_ordering_state('issue1793brand', 'unclaimed1793', NULL)->>'state'
     <> 'unavailable' THEN
    RAISE EXCEPTION 'issue_1793 A5: an UNVERIFIED venue must read `unavailable` — ordering adds no new oracle';
  END IF;
  IF public.pg_public_venue_ordering_state(NULL, NULL, NULL)->>'state'
     <> 'unavailable' THEN
    RAISE EXCEPTION 'issue_1793 A5: NULL slugs must not raise';
  END IF;
END $a$;

-- ---------------------------------------------------------------------------
-- B. A printed code resolves while the venue is paused. This is the whole
--    point: "Table 12 — ordering is paused" instead of "this code isn't
--    active", which would be a lie about a code that is.
-- ---------------------------------------------------------------------------
DO $b$
DECLARE v jsonb;
BEGIN
  v := pg_temp.state('kq7m3pd2xw');
  IF v->>'spot_state' <> 'ok' THEN
    RAISE EXCEPTION 'issue_1793 B1: a live code must resolve, got %', v->>'spot_state';
  END IF;
  IF v->'spot'->>'label' <> 'Table 12' THEN
    RAISE EXCEPTION 'issue_1793 B1: the spot must carry its printed label';
  END IF;

  UPDATE public.venue_ordering_settings
     SET paused_at = now(), paused_by_user_id = pg_temp.fx_owner()
   WHERE venue_id = pg_temp.fx_venue();
  v := pg_temp.state('kq7m3pd2xw');
  IF v->>'state' <> 'paused' OR v->>'spot_state' <> 'ok' THEN
    RAISE EXCEPTION 'issue_1793 B2: a paused venue must still resolve its OWN printed code (state=%, spot=%)',
      v->>'state', v->>'spot_state';
  END IF;
  IF v->'spot'->>'label' <> 'Table 12' THEN
    RAISE EXCEPTION 'issue_1793 B2: the guest must be told WHICH table is paused';
  END IF;
  UPDATE public.venue_ordering_settings
     SET paused_at = NULL, paused_by_user_id = NULL
   WHERE venue_id = pg_temp.fx_venue();

  -- B3 — and #1789's fail-closed resolver is UNCHANGED beside it. It still
  --      answers NULL to a paused venue, which is right for a resolver whose
  --      job is to hand a guest a menu. Fail-closed at the money, honest at the
  --      read.
  UPDATE public.venue_ordering_settings SET paused_at = now(),
         paused_by_user_id = pg_temp.fx_owner()
   WHERE venue_id = pg_temp.fx_venue();
  IF public.pg_public_qr_spot_resolve('kq7m3pd2xw') IS NOT NULL THEN
    RAISE EXCEPTION 'issue_1793 B3: #1789''s resolver must STAY fail-closed — it is green and pinned';
  END IF;
  UPDATE public.venue_ordering_settings SET paused_at = NULL,
         paused_by_user_id = NULL
   WHERE venue_id = pg_temp.fx_venue();
END $b$;

-- ---------------------------------------------------------------------------
-- C. It leaks nothing.
-- ---------------------------------------------------------------------------
DO $c$
DECLARE v jsonb;
BEGIN
  v := pg_temp.state('kq7m3pd2xw');
  -- No id a guest could enumerate. `venue_id` is the ONE exception and it is
  -- already published to anon by `venue_public_view` (a counter-pickup order
  -- must send it), so it adds no reachable surface.
  IF v->'spot' ? 'id' THEN
    RAISE EXCEPTION 'issue_1793 C1: the spot id must never leave the server';
  END IF;
  IF v ? 'brand_id' THEN
    RAISE EXCEPTION 'issue_1793 C1: the brand id must never leave the server';
  END IF;

  -- C2 — a code that serves ANOTHER venue's kitchen is not this page's code.
  --      Collapsed with "unknown" on purpose: telling them apart says which
  --      codes exist.
  IF public.pg_public_venue_ordering_state('issue1793brand', 'roofbar1793',
       'kq7m3pd2xw')->>'spot_state' <> 'unknown' THEN
    RAISE EXCEPTION 'issue_1793 C2: a foreign venue''s code must read `unknown` here';
  END IF;
  IF pg_temp.state('nosuchcode')->>'spot_state' <> 'unknown' THEN
    RAISE EXCEPTION 'issue_1793 C2: an unknown code must read `unknown`';
  END IF;
  IF pg_temp.state()->>'spot_state' <> 'none' THEN
    RAISE EXCEPTION 'issue_1793 C2: no code presented must read `none`, not `unknown`';
  END IF;

  -- C3 — a DEACTIVATED code stops resolving, which is what deactivation means.
  UPDATE public.qr_spots SET is_active = false WHERE id = pg_temp.fx_spot();
  IF pg_temp.state('kq7m3pd2xw')->>'spot_state' <> 'unknown' THEN
    RAISE EXCEPTION 'issue_1793 C3: a deactivated code must stop resolving';
  END IF;
  UPDATE public.qr_spots SET is_active = true WHERE id = pg_temp.fx_spot();
END $c$;

-- ---------------------------------------------------------------------------
-- D. It authorises nothing, and it is reachable by the people who need it.
-- ---------------------------------------------------------------------------
DO $d$
DECLARE v_vol text; v_grants int;
BEGIN
  SELECT CASE p.provolatile WHEN 'i' THEN 'immutable' WHEN 's' THEN 'stable'
                            ELSE 'volatile' END
    INTO v_vol
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'pg_public_venue_ordering_state';
  IF v_vol <> 'stable' THEN
    RAISE EXCEPTION 'issue_1793 D1: the honest read must be STABLE — it writes nothing (got %)', v_vol;
  END IF;

  -- A guest with no account, and a signed-in app user, both need it. Nobody
  -- else does, and PUBLIC does not.
  SELECT count(*) INTO v_grants
    FROM information_schema.role_routine_grants
   WHERE routine_schema = 'public'
     AND routine_name = 'pg_public_venue_ordering_state'
     AND grantee IN ('anon', 'authenticated')
     AND privilege_type = 'EXECUTE';
  IF v_grants < 2 THEN
    RAISE EXCEPTION 'issue_1793 D2: anon AND authenticated must both be able to read the honest state (got %)', v_grants;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.role_routine_grants
     WHERE routine_schema = 'public'
       AND routine_name = 'pg_public_venue_ordering_state'
       AND grantee = 'PUBLIC'
  ) THEN
    RAISE EXCEPTION 'issue_1793 D2: PUBLIC must be revoked';
  END IF;
END $d$;

ROLLBACK;

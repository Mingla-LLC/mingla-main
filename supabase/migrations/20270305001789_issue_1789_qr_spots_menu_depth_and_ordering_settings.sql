-- Issue #1789 (#1767 Phase 1) — QR spots inventory, menu depth, ordering settings.
--
-- SPEC #1788 P-7, P-7a, P-7b, P-7c, P-8, P-9, P-10 (spots) · P-11, P-11a, P-12,
-- P-13, P-14 (menu depth) · P-16 (venue ordering settings). Additive only: no
-- existing column, constraint, index, trigger or policy is altered, and not one
-- row of `orders` / `order_line_items` / `tickets` is touched.
--
-- SUPERSEDES THE DEC-C DISPLAY-ONLY CLAUSE of
-- `20261118000000_orch_1186c_menus_menu_items.sql:9-11` ("DISPLAY-ONLY (DEC-C):
-- there is NO ordering/cart/checkout/payment surface in this leg"). That applied
-- migration is deliberately NOT edited — history is not rewritten (SPEC P-64).
-- The venue menu becomes an ordering surface under #1767; what survives is that
-- the menu surface never does money itself. See the amended
-- I-PROPOSED-1186-MENU-DISPLAY-ONLY in `docs/INVARIANT_REGISTRY.md`.
--
-- Ordering itself stays DARK after this migration:
-- `venue_ordering_settings.ordering_enabled` defaults FALSE and NO RPC in this
-- migration can set it true — the switch ships in Phase 3 (#1791), so money can
-- never arrive at a venue that cannot yet see an Orders queue (orchestrator
-- ruling on OQ-7). This file creates the table and its read path only.
--
-- MONOTONIC VERSION: 20270305001789 > the frontier at implement time
-- (20270304001614_issue_1614_upsert_and_business_notification_prefs.sql).
--
-- DO NOT run `supabase db push`. Applied via the Supabase Management API after
-- REVIEW (history drift makes a blind push unsafe).

BEGIN;

-- ===========================================================================
-- 1. THE PRINTED CODE GENERATOR (P-7a) — server-side only, never client-composed.
-- ===========================================================================
-- 10 characters from a 31-symbol alphabet with no i / l / o / 0 / 1 — the
-- glyphs a human or an OCR pass confuses when reading a code off a laminated
-- table card. 31^10 ~ 8.2e14, which is unguessable at the only rate that
-- matters (server-side order-create).
--
-- P-7b: a spot code is NOT a bearer credential and pepper signatures are
-- REJECTED. A forged code buys an attacker wrong-table attribution on an order
-- they still have to pay for, while pepper rotation would invalidate every
-- printed table tent in every venue at once. Tickets are re-renderable; table
-- tents are not. Enforcement lives at order-create instead (SPEC P-22).
CREATE OR REPLACE FUNCTION public.pg_issue_1789_qr_spot_code()
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  -- 31 symbols: a-z minus i/l/o, then 2-9.
  v_alphabet constant text := 'abcdefghjkmnpqrstuvwxyz23456789';
  v_code text;
  v_i int;
  v_attempt int := 0;
BEGIN
  LOOP
    v_attempt := v_attempt + 1;
    v_code := '';
    FOR v_i IN 1..10 LOOP
      v_code := v_code || pg_catalog.substr(
        v_alphabet,
        1 + pg_catalog.floor(pg_catalog.random() * 31)::int,
        1
      );
    END LOOP;
    -- Retry on collision (P-7a). The UNIQUE index is the real authority; this
    -- loop just keeps the common path from ever reaching it.
    IF NOT EXISTS (
      SELECT 1 FROM public.qr_spots existing WHERE existing.code = v_code
    ) THEN
      RETURN v_code;
    END IF;
    IF v_attempt >= 20 THEN
      RAISE EXCEPTION 'qr_spot_code_exhausted';
    END IF;
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public.pg_issue_1789_qr_spot_code() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pg_issue_1789_qr_spot_code() FROM anon;
REVOKE ALL ON FUNCTION public.pg_issue_1789_qr_spot_code() FROM authenticated;

COMMENT ON FUNCTION public.pg_issue_1789_qr_spot_code() IS
  'Issue #1789 (SPEC #1788 P-7a): mints a 10-char opaque qr_spots.code from a '
  '31-symbol alphabet with no i/l/o/0/1. Server-side only — never granted to '
  'anon or authenticated; the BEFORE INSERT trigger is the only caller, so a '
  'client can never compose or choose a printed code.';

-- ===========================================================================
-- 2. public.qr_spots (P-7) — ONE brand-scoped inventory: tables, rooms, zones,
--    custom. The venue never manages two lists (D-3).
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.qr_spots (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- BRAND-SCOPED (D-3b): one Spots list per brand, grouped by venue.
  brand_id          uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,

  -- ---- (a) THE PHYSICAL HOME ---------------------------------------------
  venue_id          uuid NOT NULL REFERENCES public.venue_listings(id) ON DELETE CASCADE,
  kind              text NOT NULL CHECK (kind IN ('table','room_unit','zone','custom')),
  venue_table_id    uuid NULL REFERENCES public.venue_tables(id) ON DELETE CASCADE,
  stay_unit_id      uuid NULL REFERENCES public.stay_units(id)  ON DELETE CASCADE,
  zone              text NULL CHECK (zone IS NULL OR zone IN
                      ('indoor','outdoor','private_room','bar','patio')),
  label             text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 60),

  -- ---- (b) THE SERVING REFERENCE (D-3b: Room 204 orders from the Brasserie)
  serving_venue_id  uuid NOT NULL REFERENCES public.venue_listings(id) ON DELETE RESTRICT,
  serving_menu_id   uuid NULL REFERENCES public.menus(id) ON DELETE SET NULL,

  -- ---- IDENTITY: the printed code. Opaque, stable, never the label. -------
  code              text NOT NULL,
  is_active         boolean NOT NULL DEFAULT true,
  auto_provisioned  boolean NOT NULL DEFAULT false,
  sort_order        int NOT NULL DEFAULT 0,
  last_printed_at   timestamptz NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT qr_spots_code_format CHECK (code ~ '^[a-z2-9]{10}$'),
  CONSTRAINT qr_spots_kind_shape CHECK (
       (kind = 'table'     AND venue_table_id IS NOT NULL AND stay_unit_id IS NULL)
    OR (kind = 'room_unit' AND stay_unit_id   IS NOT NULL AND venue_table_id IS NULL)
    OR (kind = 'zone'      AND zone IS NOT NULL AND venue_table_id IS NULL AND stay_unit_id IS NULL)
    OR (kind = 'custom'    AND venue_table_id IS NULL AND stay_unit_id IS NULL))
);

-- The printed code resolves with no brand hint, so it is globally unique.
CREATE UNIQUE INDEX IF NOT EXISTS qr_spots_code_uniq ON public.qr_spots (code);
-- Auto-provision idempotency: at most one spot per physical unit.
CREATE UNIQUE INDEX IF NOT EXISTS qr_spots_table_uniq ON public.qr_spots (venue_table_id)
  WHERE venue_table_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS qr_spots_unit_uniq ON public.qr_spots (stay_unit_id)
  WHERE stay_unit_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS qr_spots_brand_venue_idx ON public.qr_spots (brand_id, venue_id, sort_order);
CREATE INDEX IF NOT EXISTS qr_spots_active_idx ON public.qr_spots (venue_id) WHERE is_active;
CREATE INDEX IF NOT EXISTS qr_spots_serving_idx ON public.qr_spots (serving_venue_id) WHERE is_active;

COMMENT ON TABLE public.qr_spots IS
  'Issue #1789 (SPEC #1788 P-7): ONE brand-scoped orderable-spot inventory — '
  'tables, stay units, zones and custom spots — carrying a physical home '
  '(venue_id + venue_table_id/stay_unit_id/zone) and a serving reference '
  '(serving_venue_id + optional serving_menu_id), so a hotel room can order '
  'from the sibling restaurant venue without either booking engine being '
  'touched (D-3b).';
COMMENT ON COLUMN public.qr_spots.code IS
  'Issue #1789: the PRINTED identity. Opaque, server-minted, globally unique, '
  'and IMMUTABLE for the life of the row (I-PROPOSED-1767-PRINTED-CODE-'
  'SURVIVES-A-RENAME). Labels, table names, zones and even the serving venue '
  'are re-pointable without invalidating a laminated card.';
COMMENT ON COLUMN public.qr_spots.serving_venue_id IS
  'Issue #1789 (D-3b): the venue whose menu this spot orders from. Room 204 '
  'in the Stay venue serves from the Brasserie venue under the same brand. '
  'ON DELETE RESTRICT — deleting the kitchen must not silently orphan a '
  'printed QR.';

-- ---------------------------------------------------------------------------
-- 2a. updated_at
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_qr_spots_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS qr_spots_set_updated_at ON public.qr_spots;
CREATE TRIGGER qr_spots_set_updated_at
  BEFORE UPDATE ON public.qr_spots
  FOR EACH ROW EXECUTE FUNCTION public.tg_qr_spots_set_updated_at();

-- ---------------------------------------------------------------------------
-- 2b. The code is minted by the server and can never change (P-7a + the
--     PRINTED-CODE-SURVIVES-A-RENAME invariant).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_qr_spots_mint_code()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  -- Unconditional: any client-supplied value is DISCARDED, so "never
  -- client-composed" is a property of the schema rather than of a code review.
  NEW.code := public.pg_issue_1789_qr_spot_code();
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS qr_spots_mint_code ON public.qr_spots;
CREATE TRIGGER qr_spots_mint_code
  BEFORE INSERT ON public.qr_spots
  FOR EACH ROW EXECUTE FUNCTION public.tg_qr_spots_mint_code();

CREATE OR REPLACE FUNCTION public.tg_qr_spots_code_is_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.code IS DISTINCT FROM OLD.code THEN
    RAISE EXCEPTION 'qr_spot_code_immutable';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS qr_spots_code_immutable ON public.qr_spots;
CREATE TRIGGER qr_spots_code_immutable
  BEFORE UPDATE ON public.qr_spots
  FOR EACH ROW EXECUTE FUNCTION public.tg_qr_spots_code_is_immutable();

-- ---------------------------------------------------------------------------
-- 2c. Integrity: physical home AND serving reference both belong to the brand
--     (P-8). The shipped helper reads (brand_id, venue_id), so the serving
--     column gets a thin sibling rather than a widening of the shared one.
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS qr_spots_venue_brand_match ON public.qr_spots;
CREATE TRIGGER qr_spots_venue_brand_match
  BEFORE INSERT OR UPDATE OF brand_id, venue_id ON public.qr_spots
  FOR EACH ROW EXECUTE FUNCTION public._orch1255_venue_belongs_to_brand();

CREATE OR REPLACE FUNCTION public._issue_1767_serving_venue_belongs_to_brand()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.venue_listings v
     WHERE v.id = NEW.serving_venue_id AND v.brand_id = NEW.brand_id
  ) THEN
    RAISE EXCEPTION 'serving_venue_brand_mismatch';
  END IF;
  IF NEW.serving_menu_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.menus m
     WHERE m.id = NEW.serving_menu_id
       AND m.brand_id = NEW.brand_id
       AND m.venue_id = NEW.serving_venue_id
  ) THEN
    RAISE EXCEPTION 'serving_menu_venue_mismatch';
  END IF;
  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public._issue_1767_serving_venue_belongs_to_brand() IS
  'Issue #1789 (SPEC #1788 P-8): a spot can only ever order from its own '
  'brand. serving_venue_id must belong to the row''s brand, and '
  'serving_menu_id (when present) must be a menu of the serving venue. '
  'Raises serving_venue_brand_mismatch / serving_menu_venue_mismatch.';

DROP TRIGGER IF EXISTS qr_spots_serving_venue_brand_match ON public.qr_spots;
CREATE TRIGGER qr_spots_serving_venue_brand_match
  BEFORE INSERT OR UPDATE OF brand_id, serving_venue_id, serving_menu_id
  ON public.qr_spots
  FOR EACH ROW EXECUTE FUNCTION public._issue_1767_serving_venue_belongs_to_brand();

-- ---------------------------------------------------------------------------
-- 2d. RLS (P-9) — the venue_tables pair verbatim. NO anon policy: the guest
--     path is exactly one narrow SECURITY DEFINER resolver (section 3).
-- ---------------------------------------------------------------------------
ALTER TABLE public.qr_spots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "qr_spots brand member can read" ON public.qr_spots;
CREATE POLICY "qr_spots brand member can read" ON public.qr_spots
  FOR SELECT TO authenticated
  USING (public.biz_is_brand_member_for_read_for_caller(brand_id));

DROP POLICY IF EXISTS "qr_spots manager plus can write" ON public.qr_spots;
CREATE POLICY "qr_spots manager plus can write" ON public.qr_spots
  FOR ALL TO authenticated
  USING (public.biz_brand_effective_rank_for_caller(brand_id) >= public.biz_role_rank('event_manager'))
  WITH CHECK (public.biz_brand_effective_rank_for_caller(brand_id) >= public.biz_role_rank('event_manager'));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.qr_spots TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.qr_spots TO service_role;
REVOKE ALL ON public.qr_spots FROM anon;

-- ===========================================================================
-- 3. THE AUTO-PROVISION TRIGGERS (P-7c) — the venue never manages two lists.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.tg_issue_1789_provision_spot_for_table()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $function$
BEGIN
  INSERT INTO public.qr_spots (
    brand_id, venue_id, kind, venue_table_id, zone, label,
    serving_venue_id, serving_menu_id, code, is_active, auto_provisioned, sort_order
  )
  VALUES (
    NEW.brand_id, NEW.venue_id, 'table', NEW.id, NEW.zone,
    left(btrim(NEW.name), 60),
    -- A table serves its own venue's whole menu.
    NEW.venue_id, NULL,
    'pending0aa',   -- discarded by qr_spots_mint_code; the column is NOT NULL.
    COALESCE(NEW.is_active, true) AND NEW.deleted_at IS NULL,
    true,
    COALESCE(NEW.sort_order, 0)
  )
  ON CONFLICT (venue_table_id) WHERE venue_table_id IS NOT NULL DO NOTHING;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS venue_tables_provision_qr_spot ON public.venue_tables;
CREATE TRIGGER venue_tables_provision_qr_spot
  AFTER INSERT ON public.venue_tables
  FOR EACH ROW EXECUTE FUNCTION public.tg_issue_1789_provision_spot_for_table();

CREATE OR REPLACE FUNCTION public.tg_issue_1789_provision_spot_for_unit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $function$
BEGIN
  INSERT INTO public.qr_spots (
    brand_id, venue_id, kind, stay_unit_id, label,
    serving_venue_id, serving_menu_id, code, is_active, auto_provisioned, sort_order
  )
  VALUES (
    NEW.brand_id, NEW.venue_id, 'room_unit', NEW.id,
    left(btrim(NEW.name), 60),
    -- PROVISIONAL: a Stay venue has no menu of its own (D-3b), so the operator
    -- must re-point this at the kitchen that actually serves the room. The spot
    -- therefore lands INACTIVE and shows the "Choose which kitchen serves this
    -- room" to-do in the Spots list. It can never silently print a dead QR.
    NEW.venue_id, NULL,
    'pending0aa',
    false,
    true,
    0
  )
  ON CONFLICT (stay_unit_id) WHERE stay_unit_id IS NOT NULL DO NOTHING;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS stay_units_provision_qr_spot ON public.stay_units;
CREATE TRIGGER stay_units_provision_qr_spot
  AFTER INSERT ON public.stay_units
  FOR EACH ROW
  WHEN (NEW.status = 'active')
  EXECUTE FUNCTION public.tg_issue_1789_provision_spot_for_unit();

-- ---------------------------------------------------------------------------
-- 3a. Lifecycle mirroring: soft-delete / deactivate / archive the physical unit
--     and its spot follows. RENAMES NEVER TOUCH `code` — the label follows only
--     while the spot is still auto_provisioned AND the operator has not
--     overridden it (label still equals the OLD name).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_issue_1789_sync_spot_from_table()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $function$
BEGIN
  IF (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL)
     OR (OLD.is_active AND NOT NEW.is_active) THEN
    UPDATE public.qr_spots s
       SET is_active = false
     WHERE s.venue_table_id = NEW.id;
  END IF;

  IF NEW.name IS DISTINCT FROM OLD.name THEN
    UPDATE public.qr_spots s
       SET label = left(btrim(NEW.name), 60)
     WHERE s.venue_table_id = NEW.id
       AND s.auto_provisioned
       AND s.label = left(btrim(OLD.name), 60);
  END IF;

  IF NEW.zone IS DISTINCT FROM OLD.zone THEN
    UPDATE public.qr_spots s
       SET zone = NEW.zone
     WHERE s.venue_table_id = NEW.id
       AND s.auto_provisioned;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS venue_tables_sync_qr_spot ON public.venue_tables;
CREATE TRIGGER venue_tables_sync_qr_spot
  AFTER UPDATE ON public.venue_tables
  FOR EACH ROW EXECUTE FUNCTION public.tg_issue_1789_sync_spot_from_table();

CREATE OR REPLACE FUNCTION public.tg_issue_1789_sync_spot_from_unit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.status IN ('archived','out_of_service') AND OLD.status = 'active' THEN
    UPDATE public.qr_spots s
       SET is_active = false
     WHERE s.stay_unit_id = NEW.id;
  END IF;

  IF NEW.name IS DISTINCT FROM OLD.name THEN
    UPDATE public.qr_spots s
       SET label = left(btrim(NEW.name), 60)
     WHERE s.stay_unit_id = NEW.id
       AND s.auto_provisioned
       AND s.label = left(btrim(OLD.name), 60);
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS stay_units_sync_qr_spot ON public.stay_units;
CREATE TRIGGER stay_units_sync_qr_spot
  AFTER UPDATE ON public.stay_units
  FOR EACH ROW EXECUTE FUNCTION public.tg_issue_1789_sync_spot_from_unit();

-- ---------------------------------------------------------------------------
-- 3b. Backfill (P-7c) — live tables and named, active stay units.
-- ---------------------------------------------------------------------------
INSERT INTO public.qr_spots (
  brand_id, venue_id, kind, venue_table_id, zone, label,
  serving_venue_id, serving_menu_id, code, is_active, auto_provisioned, sort_order
)
SELECT t.brand_id, t.venue_id, 'table', t.id, t.zone,
       left(btrim(t.name), 60),
       t.venue_id, NULL, 'pending0aa', true, true, COALESCE(t.sort_order, 0)
  FROM public.venue_tables t
 WHERE t.deleted_at IS NULL
   AND t.is_active
ON CONFLICT (venue_table_id) WHERE venue_table_id IS NOT NULL DO NOTHING;

INSERT INTO public.qr_spots (
  brand_id, venue_id, kind, stay_unit_id, label,
  serving_venue_id, serving_menu_id, code, is_active, auto_provisioned, sort_order
)
SELECT u.brand_id, u.venue_id, 'room_unit', u.id,
       left(btrim(u.name), 60),
       u.venue_id, NULL, 'pending0aa', false, true, 0
  FROM public.stay_units u
 WHERE u.status = 'active'
ON CONFLICT (stay_unit_id) WHERE stay_unit_id IS NOT NULL DO NOTHING;

-- ===========================================================================
-- 4. public.venue_ordering_settings (P-16) — the venue's own switches.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.venue_ordering_settings (
  venue_id                uuid PRIMARY KEY REFERENCES public.venue_listings(id) ON DELETE CASCADE,
  brand_id                uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  -- D-4 / Phase 4: the master switch. DEFAULT FALSE. Ordering is opt-in, per
  -- venue, and the RPC that can set it TRUE ships in Phase 3 (#1791) — not here.
  ordering_enabled        boolean NOT NULL DEFAULT false,
  -- D-7b: the pause switch is THEIRS. Mingla never writes these two columns.
  paused_at               timestamptz NULL,
  paused_by_user_id       uuid NULL,
  -- D-9: the venue's own service charge. Venue revenue => inside Mingla's fee basis.
  service_charge_bps      int  NOT NULL DEFAULT 0 CHECK (service_charge_bps BETWEEN 0 AND 3000),
  service_charge_label    text NOT NULL DEFAULT 'Service charge'
                            CHECK (length(btrim(service_charge_label)) BETWEEN 3 AND 40),
  -- D-2: tips. Where a service charge is set, the tip selector DEFAULTS TO NONE.
  tips_enabled            boolean NOT NULL DEFAULT true,
  tip_presets_bps         int[] NULL CHECK (tip_presets_bps IS NULL
                            OR (array_length(tip_presets_bps,1) BETWEEN 1 AND 4)),
  counter_pickup_enabled  boolean NOT NULL DEFAULT true,   -- D-3a
  staff_tabs_enabled      boolean NOT NULL DEFAULT true,   -- D-11 / D-2 AMENDED
  guest_cancel_window_ok  boolean NOT NULL DEFAULT true,   -- D-7a; venue cannot set false in v1
  prep_time_minutes       int NULL CHECK (prep_time_minutes IS NULL
                            OR (prep_time_minutes BETWEEN 1 AND 180)),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT venue_ordering_settings_pause_shape CHECK (
    (paused_at IS NULL) = (paused_by_user_id IS NULL))
);

CREATE INDEX IF NOT EXISTS venue_ordering_settings_brand_idx
  ON public.venue_ordering_settings (brand_id);

COMMENT ON TABLE public.venue_ordering_settings IS
  'Issue #1789 (SPEC #1788 P-16): per-venue ordering switches. Separate from '
  'venue_reservation_settings on purpose — a venue can take orders without '
  'taking reservations, and the reservation toggle gates a whole module band '
  '(I-PROPOSED-1148-RESERVATION-TOGGLE-GATES-SUITE). Coupling them would drag '
  'ordering under that gate.';
COMMENT ON COLUMN public.venue_ordering_settings.paused_at IS
  'Issue #1789 (D-7b, I-PROPOSED-1767-NEVER-PAUSE-A-VENUE-FOR-THEM): exactly '
  'ONE writer — the venue''s own pause control in their Orders module, with a '
  'verified staff user id. No sweep, cron, webhook, admin action or failure '
  'path writes this column. Orders keep flowing while a venue is slow; the '
  'safety valve is the guest''s own way out, never a platform kill switch.';
COMMENT ON COLUMN public.venue_ordering_settings.ordering_enabled IS
  'Issue #1789: DEFAULT FALSE and no RPC in this migration can set it true. '
  'The enable path ships in Phase 3 (#1791) so money can never arrive at a '
  'venue whose brand cannot yet see an Orders queue (orchestrator ruling OQ-7).';

CREATE OR REPLACE FUNCTION public.tg_venue_ordering_settings_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS venue_ordering_settings_set_updated_at ON public.venue_ordering_settings;
CREATE TRIGGER venue_ordering_settings_set_updated_at
  BEFORE UPDATE ON public.venue_ordering_settings
  FOR EACH ROW EXECUTE FUNCTION public.tg_venue_ordering_settings_set_updated_at();

DROP TRIGGER IF EXISTS venue_ordering_settings_venue_brand_match ON public.venue_ordering_settings;
CREATE TRIGGER venue_ordering_settings_venue_brand_match
  BEFORE INSERT OR UPDATE OF brand_id, venue_id ON public.venue_ordering_settings
  FOR EACH ROW EXECUTE FUNCTION public._orch1255_venue_belongs_to_brand();

ALTER TABLE public.venue_ordering_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "venue_ordering_settings brand member can read" ON public.venue_ordering_settings;
CREATE POLICY "venue_ordering_settings brand member can read" ON public.venue_ordering_settings
  FOR SELECT TO authenticated
  USING (public.biz_is_brand_member_for_read_for_caller(brand_id));

DROP POLICY IF EXISTS "venue_ordering_settings manager plus can write" ON public.venue_ordering_settings;
CREATE POLICY "venue_ordering_settings manager plus can write" ON public.venue_ordering_settings
  FOR ALL TO authenticated
  USING (public.biz_brand_effective_rank_for_caller(brand_id) >= public.biz_role_rank('event_manager'))
  WITH CHECK (public.biz_brand_effective_rank_for_caller(brand_id) >= public.biz_role_rank('event_manager'));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.venue_ordering_settings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.venue_ordering_settings TO service_role;
REVOKE ALL ON public.venue_ordering_settings FROM anon;

-- ===========================================================================
-- 5. MENU DEPTH (P-11, P-11a, P-12) — modifier groups, modifiers, and the
--    additive item/menu columns that make a menu orderable.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.menu_modifier_groups (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_item_id   uuid NOT NULL REFERENCES public.menu_items(id) ON DELETE CASCADE,
  -- Denormalised so RLS scopes by brand without a join, exactly as menu_items
  -- documents (20261118000000:64-67 — a CHECK cannot cross-reference).
  brand_id       uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  name           text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  selection_mode text NOT NULL CHECK (selection_mode IN ('single','multi')),
  min_select     int  NOT NULL DEFAULT 0 CHECK (min_select >= 0 AND min_select <= 20),
  max_select     int  NULL CHECK (max_select IS NULL OR (max_select >= 1 AND max_select <= 20)),
  is_active      boolean NOT NULL DEFAULT true,
  sort_order     int  NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  -- 'single' + min_select=1 IS the required-single-choice case
  -- ("How would you like it?" — Rare.)
  CONSTRAINT menu_modifier_groups_select_shape CHECK (
       (selection_mode = 'single' AND min_select <= 1 AND (max_select IS NULL OR max_select = 1))
    OR (selection_mode = 'multi'  AND (max_select IS NULL OR max_select >= min_select)))
);

CREATE TABLE IF NOT EXISTS public.menu_modifiers (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id          uuid NOT NULL REFERENCES public.menu_modifier_groups(id) ON DELETE CASCADE,
  brand_id          uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  name              text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  -- May be NEGATIVE (a smaller portion), so no >= 0 CHECK. Bounded both ways.
  price_delta_cents int  NOT NULL DEFAULT 0
                      CHECK (price_delta_cents BETWEEN -100000000 AND 100000000),
  currency          text NOT NULL CHECK (currency = upper(currency) AND length(currency) = 3),
  is_available      boolean NOT NULL DEFAULT true,
  sort_order        int  NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS menu_modifier_groups_item_idx ON public.menu_modifier_groups (menu_item_id, sort_order);
CREATE INDEX IF NOT EXISTS menu_modifier_groups_brand_idx ON public.menu_modifier_groups (brand_id);
CREATE INDEX IF NOT EXISTS menu_modifiers_group_idx ON public.menu_modifiers (group_id, sort_order);
CREATE INDEX IF NOT EXISTS menu_modifiers_brand_idx ON public.menu_modifiers (brand_id);

COMMENT ON TABLE public.menu_modifier_groups IS
  'Issue #1789 (SPEC #1788 P-11): required-choice and multi-add option groups '
  'on a menu item. selection_mode=single + min_select=1 is the required single '
  'choice; multi with max_select is "pick up to N".';
COMMENT ON COLUMN public.menu_modifiers.price_delta_cents IS
  'Issue #1789: signed minor units. Negative is legitimate (a smaller portion), '
  'so there is deliberately no >= 0 CHECK.';

-- ---------------------------------------------------------------------------
-- 5a. updated_at + P-11a: a modifier's currency must equal its item's.
--     Cross-table, so a trigger rather than a CHECK.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_menu_modifier_groups_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS menu_modifier_groups_set_updated_at ON public.menu_modifier_groups;
CREATE TRIGGER menu_modifier_groups_set_updated_at
  BEFORE UPDATE ON public.menu_modifier_groups
  FOR EACH ROW EXECUTE FUNCTION public.tg_menu_modifier_groups_set_updated_at();

CREATE OR REPLACE FUNCTION public.tg_menu_modifiers_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS menu_modifiers_set_updated_at ON public.menu_modifiers;
CREATE TRIGGER menu_modifiers_set_updated_at
  BEFORE UPDATE ON public.menu_modifiers
  FOR EACH ROW EXECUTE FUNCTION public.tg_menu_modifiers_set_updated_at();

CREATE OR REPLACE FUNCTION public.tg_issue_1789_modifier_currency_matches_item()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  v_item_currency text;
BEGIN
  SELECT mi.currency
    INTO v_item_currency
    FROM public.menu_modifier_groups g
    JOIN public.menu_items mi ON mi.id = g.menu_item_id
   WHERE g.id = NEW.group_id;

  IF v_item_currency IS NULL THEN
    RAISE EXCEPTION 'modifier_group_missing';
  END IF;
  IF NEW.currency IS DISTINCT FROM v_item_currency THEN
    -- I-PROPOSED-1767-NEVER-CROSS-SUM-CURRENCIES: a modifier priced in another
    -- currency is the cross-sum bug in disguise.
    RAISE EXCEPTION 'modifier_currency_mismatch';
  END IF;
  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.tg_issue_1789_modifier_currency_matches_item() IS
  'Issue #1789 (SPEC #1788 P-11a): a modifier must carry its menu item''s '
  'currency. Cross-table, so this cannot be a CHECK. Re-asserted at '
  'order-create (P-22 gate 6).';

DROP TRIGGER IF EXISTS menu_modifiers_currency_matches_item ON public.menu_modifiers;
CREATE TRIGGER menu_modifiers_currency_matches_item
  BEFORE INSERT OR UPDATE OF currency, group_id ON public.menu_modifiers
  FOR EACH ROW EXECUTE FUNCTION public.tg_issue_1789_modifier_currency_matches_item();

-- ---------------------------------------------------------------------------
-- 5b. RLS — the menu_items pair verbatim, keyed on the denormalised brand_id.
-- ---------------------------------------------------------------------------
ALTER TABLE public.menu_modifier_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "menu_modifier_groups brand member can read" ON public.menu_modifier_groups;
CREATE POLICY "menu_modifier_groups brand member can read" ON public.menu_modifier_groups
  FOR SELECT TO authenticated
  USING (public.biz_is_brand_member_for_read_for_caller(brand_id));

DROP POLICY IF EXISTS "menu_modifier_groups manager plus can write" ON public.menu_modifier_groups;
CREATE POLICY "menu_modifier_groups manager plus can write" ON public.menu_modifier_groups
  FOR ALL TO authenticated
  USING (public.biz_brand_effective_rank_for_caller(brand_id) >= public.biz_role_rank('event_manager'))
  WITH CHECK (public.biz_brand_effective_rank_for_caller(brand_id) >= public.biz_role_rank('event_manager'));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.menu_modifier_groups TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.menu_modifier_groups TO service_role;
REVOKE ALL ON public.menu_modifier_groups FROM anon;

ALTER TABLE public.menu_modifiers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "menu_modifiers brand member can read" ON public.menu_modifiers;
CREATE POLICY "menu_modifiers brand member can read" ON public.menu_modifiers
  FOR SELECT TO authenticated
  USING (public.biz_is_brand_member_for_read_for_caller(brand_id));

DROP POLICY IF EXISTS "menu_modifiers manager plus can write" ON public.menu_modifiers;
CREATE POLICY "menu_modifiers manager plus can write" ON public.menu_modifiers
  FOR ALL TO authenticated
  USING (public.biz_brand_effective_rank_for_caller(brand_id) >= public.biz_role_rank('event_manager'))
  WITH CHECK (public.biz_brand_effective_rank_for_caller(brand_id) >= public.biz_role_rank('event_manager'));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.menu_modifiers TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.menu_modifiers TO service_role;
REVOKE ALL ON public.menu_modifiers FROM anon;

-- ---------------------------------------------------------------------------
-- 5c. P-12 — additive ALTERs. Every existing row is unchanged: the defaults ARE
--     today's behaviour.
-- ---------------------------------------------------------------------------
ALTER TABLE public.menu_items
  ADD COLUMN IF NOT EXISTS allows_notes boolean NOT NULL DEFAULT true;
ALTER TABLE public.menu_items
  ADD COLUMN IF NOT EXISTS prep_station text NULL;
ALTER TABLE public.menu_items
  ADD COLUMN IF NOT EXISTS cost_cents int NULL;

ALTER TABLE public.menus
  ADD COLUMN IF NOT EXISTS service_window_start time NULL;
ALTER TABLE public.menus
  ADD COLUMN IF NOT EXISTS service_window_end   time NULL;
ALTER TABLE public.menus
  ADD COLUMN IF NOT EXISTS service_days         smallint[] NULL;

DO $constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'menu_items_prep_station_shape'
  ) THEN
    ALTER TABLE public.menu_items
      ADD CONSTRAINT menu_items_prep_station_shape CHECK (
        prep_station IS NULL OR prep_station IN ('kitchen','bar','other'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'menu_items_cost_cents_shape'
  ) THEN
    ALTER TABLE public.menu_items
      ADD CONSTRAINT menu_items_cost_cents_shape CHECK (
        cost_cents IS NULL OR (cost_cents >= 0 AND cost_cents <= 100000000));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'menus_service_window_shape'
  ) THEN
    ALTER TABLE public.menus
      ADD CONSTRAINT menus_service_window_shape CHECK (
        (service_window_start IS NULL) = (service_window_end IS NULL));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'menus_service_days_shape'
  ) THEN
    ALTER TABLE public.menus
      ADD CONSTRAINT menus_service_days_shape CHECK (
        service_days IS NULL
        OR (array_length(service_days,1) BETWEEN 1 AND 7
            AND service_days <@ ARRAY[1,2,3,4,5,6,7]::smallint[]));
  END IF;
END
$constraints$;

COMMENT ON COLUMN public.menu_items.allows_notes IS
  'Issue #1789 (D-6): whether a guest may attach a kitchen note to this line. '
  'Notes are capped at 140 characters on the order row so a kitchen ticket '
  'stays readable and the field can never become a free-text data channel.';
COMMENT ON COLUMN public.menu_items.prep_station IS
  'Issue #1789 (SPEC #1788 P-12): routing seam for the Phase-5 Service Mode '
  'kiosk. Nullable, never required.';
COMMENT ON COLUMN public.menu_items.cost_cents IS
  'Issue #1789 (SPEC #1788 P-12): the ONLY legitimate source of a true-margin '
  'quadrant. Nullable and opt-in — until a venue fills it, menu-engineering '
  'quadrants render BY PRICE, honestly labelled, and are never called profit '
  '(P-58). Never exposed on the public menu view.';
COMMENT ON COLUMN public.menus.service_days IS
  'Issue #1789: ISO day-of-week 1..7. NULL = every day.';
COMMENT ON COLUMN public.menus.service_window_end IS
  'Issue #1789: a value LESS than service_window_start means the window WRAPS '
  'MIDNIGHT (a late-night menu) — a naive BETWEEN gets this wrong. Both NULL = '
  'always available, which is today''s behaviour and therefore the backfill. '
  'Evaluated in VENUE-LOCAL time via the shipped #1403 ladder '
  '(venue_availability_config.iana_timezone -> place_pool.utc_offset_minutes '
  '-> UTC) — never the server''s clock and never the device''s.';

-- ===========================================================================
-- 6. THE PUBLIC READ PATHS
-- ===========================================================================
-- 6a. P-14 — public_menus_view gains ordering columns, APPENDED AT THE END so
--     CREATE OR REPLACE preserves the existing column contract (the discipline
--     20270122001365:118-120 already states). cost_cents, prep_station and
--     anything about is_available beyond the existing filter stay OUT.
CREATE OR REPLACE VIEW public.public_menus_view AS
  SELECT mi.id,
         mi.menu_id,
         mi.brand_id,
         b.slug                AS brand_slug,
         m.name                AS menu_name,
         m.description         AS menu_description,
         m.sort_order          AS menu_sort_order,
         mi.name               AS item_name,
         mi.description        AS item_description,
         mi.price_cents,
         mi.currency,
         mi.sort_order         AS item_sort_order,
         m.venue_id,
         v.slug                AS venue_slug,
         -- Issue #1789 additive tail (SPEC #1788 P-14).
         mi.id                 AS item_id,
         mi.allows_notes,
         mi.photo_url,
         m.service_window_start,
         m.service_window_end,
         m.service_days
  FROM public.menu_items mi
  JOIN public.menus m
    ON m.id = mi.menu_id
   AND m.brand_id = mi.brand_id
   AND m.is_active = true
  JOIN public.venue_listings v
    ON v.id = m.venue_id
   AND v.brand_id = m.brand_id
   AND v.claim_status = 'verified'
  JOIN public.brands b
    ON b.id = m.brand_id
   AND b.deleted_at IS NULL
  WHERE mi.is_available = true;

ALTER VIEW public.public_menus_view SET (security_invoker = false);
GRANT SELECT ON public.public_menus_view TO anon, authenticated;

COMMENT ON VIEW public.public_menus_view IS
  'Issue #1365 + #1789: anon menu rows for one exact verified venue. '
  'Unassigned and sibling-venue menus are never exposed. #1789 appends '
  'item_id, allows_notes, photo_url and the service window at the END so the '
  'prior column contract is preserved. cost_cents and prep_station are '
  'deliberately absent — a venue''s food cost is not public.';

-- 6b. P-14 — the modifier payload, served OUT of the view so the hot public
--     read never grows a row-multiplying join.
CREATE OR REPLACE FUNCTION public.pg_public_menu_modifiers(p_menu_item_ids uuid[])
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT COALESCE(
    pg_catalog.jsonb_object_agg(per_item.menu_item_id::text, per_item.groups),
    '{}'::jsonb
  )
  FROM (
    SELECT g.menu_item_id,
           pg_catalog.jsonb_agg(
             pg_catalog.jsonb_build_object(
               'id', g.id,
               'name', g.name,
               'selection_mode', g.selection_mode,
               'min_select', g.min_select,
               'max_select', g.max_select,
               'sort_order', g.sort_order,
               'modifiers', COALESCE(mods.modifiers, '[]'::jsonb)
             )
             ORDER BY g.sort_order, g.name
           ) AS groups
      FROM public.menu_modifier_groups g
      JOIN public.menu_items mi ON mi.id = g.menu_item_id
      JOIN public.menus m
        ON m.id = mi.menu_id
       AND m.brand_id = mi.brand_id
       AND m.is_active = true
      JOIN public.venue_listings v
        ON v.id = m.venue_id
       AND v.brand_id = m.brand_id
       AND v.claim_status = 'verified'
      JOIN public.brands b
        ON b.id = m.brand_id
       AND b.deleted_at IS NULL
      LEFT JOIN LATERAL (
        SELECT pg_catalog.jsonb_agg(
                 pg_catalog.jsonb_build_object(
                   'id', mo.id,
                   'name', mo.name,
                   'price_delta_cents', mo.price_delta_cents,
                   'currency', mo.currency,
                   'sort_order', mo.sort_order
                 )
                 ORDER BY mo.sort_order, mo.name
               ) AS modifiers
          FROM public.menu_modifiers mo
         WHERE mo.group_id = g.id
           AND mo.is_available
      ) AS mods ON true
     WHERE g.menu_item_id = ANY (p_menu_item_ids)
       AND g.is_active
       AND mi.is_available
     GROUP BY g.menu_item_id
  ) AS per_item;
$function$;

REVOKE ALL ON FUNCTION public.pg_public_menu_modifiers(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pg_public_menu_modifiers(uuid[]) TO anon, authenticated;

COMMENT ON FUNCTION public.pg_public_menu_modifiers(uuid[]) IS
  'Issue #1789 (SPEC #1788 P-14): the option groups for a batch of public menu '
  'items, keyed by item id. Verified-venue gated exactly like '
  'public_menus_view. Kept OUT of the view so the hot public menu read never '
  'grows a row-multiplying join.';

-- 6c. P-9 — the ONE guest-facing spot resolution. Fail-closed: NULL for
--     anything unknown, inactive, unverified, paused, or ordering-disabled.
--     Exposes no id a guest could enumerate.
CREATE OR REPLACE FUNCTION public.pg_public_qr_spot_resolve(p_code text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT pg_catalog.jsonb_build_object(
           'spot_label',       s.label,
           'kind',             s.kind,
           'brand_slug',       b.slug,
           'venue_slug',       sv.slug,
           'serving_menu_id',  s.serving_menu_id,
           'ordering_enabled', vos.ordering_enabled
         )
    FROM public.qr_spots s
    JOIN public.venue_listings sv
      ON sv.id = s.serving_venue_id
     AND sv.brand_id = s.brand_id
     AND sv.claim_status = 'verified'
    JOIN public.brands b
      ON b.id = s.brand_id
     AND b.deleted_at IS NULL
    JOIN public.venue_ordering_settings vos
      ON vos.venue_id = s.serving_venue_id
     AND vos.ordering_enabled
     AND vos.paused_at IS NULL
   WHERE s.code = p_code
     AND s.is_active
   LIMIT 1;
$function$;

REVOKE ALL ON FUNCTION public.pg_public_qr_spot_resolve(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pg_public_qr_spot_resolve(text) TO anon, authenticated;

COMMENT ON FUNCTION public.pg_public_qr_spot_resolve(text) IS
  'Issue #1789 (SPEC #1788 P-9): the ONLY guest-facing read of qr_spots '
  '(the table itself has no anon policy). Returns exactly spot_label, kind, '
  'brand_slug, venue_slug, serving_menu_id and ordering_enabled — no id a '
  'guest could enumerate — and NULL for anything unknown, inactive, '
  'unverified, paused or ordering-disabled. Fail-closed by construction: '
  'while ordering_enabled is false everywhere (Phase 1), every code resolves '
  'to NULL.';

COMMIT;

NOTIFY pgrst, 'reload schema';

-- #4490 P1 migration 1 — venue spaces, features, category widen, venue capabilities.
--
-- Features, not venue types: a venue is a place with SPACES, and every
-- capability is a FEATURE the host switches on. `venue_category` becomes a
-- label and a starting preset only.
--
-- What this file does (spec 01 §3.1 + §4.1, reconciliation conflicts 6–11, 32, A-N2):
--   1. btree_gist (P4 needs it; P1 owns the extension).
--   2. venue category list widened to nine (2 table CHECKs + the details-change
--      CHECK + two in-function validators; the third is in 20281203054490) and
--      `secondary_categories`.
--   3. venue capabilities widened: venue.manage_offers, venue.manage_bookings,
--      venue.view_bookings, venue.check_in, venue.manage_money.
--   4. `venue_spaces`, `venue_space_combinations`, `venue_features` (+ RLS:
--      read for brand members, Mingla admins and any `venue.*` staff of that
--      venue; no client writes) and a private write-receipt table for
--      idempotent replays.
--   5. RPCs: issue_4490_get_venue_features, issue_4490_set_venue_feature
--      (p_cascade), issue_4490_apply_feature_preset, issue_4490_manage_space,
--      issue_4490_manage_space_combination.
--   6. Two-way mirror with the legacy switches: set_venue_feature writes
--      venue_reservation_settings.reservations_enabled / venue_ordering_settings
--      .ordering_enabled in the same transaction; an AFTER trigger on those two
--      columns writes the feature back (old Host builds keep writing them
--      directly). A transaction-local flag stops the round trip.
--   7. Backfill: one row per venue per key. table_reservations and waitlist =
--      reservations_enabled; menu = true for every non-stay venue; table_ordering
--      = ordering_enabled; stays = category stay; everything else off. A venue
--      without stored rows (new, or still in pending review) reads exactly
--      these values, derived live, until a host writes a feature.
--   8. The three new venue lanes move #2099's reviewed dependency-schema pin;
--      20281203054490_issue_4490_p1_pending_venue_repin.sql advances it (and
--      teaches the correction the nine categories). They stay disallowed lanes.
--
-- Conflicts raise PT409 (never 40001). Static SQL.
--
-- DO NOT run `supabase db push`. Local stack only until Seth says otherwise.

BEGIN;
SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. btree_gist
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;

-- ---------------------------------------------------------------------------
-- 2. Venue category list (nine) and secondary categories.
-- ---------------------------------------------------------------------------
ALTER TABLE public.venue_listings DROP CONSTRAINT IF EXISTS venue_listings_venue_category_check;
ALTER TABLE public.venue_listings
  ADD CONSTRAINT venue_listings_venue_category_check
  CHECK (venue_category IN (
    'restaurant', 'play', 'creative_and_arts', 'stay',
    'bar_lounge', 'club', 'cafe', 'event_space', 'coworking'
  ));

ALTER TABLE public.brands DROP CONSTRAINT IF EXISTS brands_venue_category_check;
ALTER TABLE public.brands
  ADD CONSTRAINT brands_venue_category_check
  CHECK (
    venue_category IS NULL
    OR venue_category IN (
      'restaurant', 'play', 'creative_and_arts', 'stay',
      'bar_lounge', 'club', 'cafe', 'event_space', 'coworking'
    )
  );

ALTER TABLE public.venue_listings DROP CONSTRAINT IF EXISTS venue_listings_details_change_values_check;
ALTER TABLE public.venue_listings
  ADD CONSTRAINT venue_listings_details_change_values_check
  CHECK (
    (details_change_status IS NULL OR details_change_status IN ('pending', 'rejected'))
    AND (details_change_name IS NULL OR length(btrim(details_change_name)) BETWEEN 1 AND 80)
    AND (details_change_venue_category IS NULL
         OR details_change_venue_category IN (
           'restaurant', 'play', 'creative_and_arts', 'stay',
           'bar_lounge', 'club', 'cafe', 'event_space', 'coworking'
         ))
    AND (details_change_country_code IS NULL OR details_change_country_code ~ '^[A-Z]{2}$')
  );

ALTER TABLE public.venue_listings
  ADD COLUMN IF NOT EXISTS secondary_categories text[] NOT NULL DEFAULT '{}'::text[];
ALTER TABLE public.venue_listings
  ADD CONSTRAINT venue_listings_secondary_categories_check
  CHECK (
    cardinality(secondary_categories) <= 2
    AND secondary_categories <@ ARRAY[
      'restaurant', 'play', 'creative_and_arts', 'stay',
      'bar_lounge', 'club', 'cafe', 'event_space', 'coworking'
    ]::text[]
    AND NOT (venue_category = ANY (secondary_categories))
    AND (cardinality(secondary_categories) < 2
         OR secondary_categories[1] IS DISTINCT FROM secondary_categories[2])
  );
COMMENT ON COLUMN public.venue_listings.secondary_categories IS
  '#4490: up to two extra category labels. Labels only: features, not categories, decide what a venue shows and sells.';

-- ---------------------------------------------------------------------------
-- 3. Venue capabilities (4188 helper + both grant CHECKs).
-- ---------------------------------------------------------------------------
ALTER TABLE public.brand_invitation_venue_grants
  DROP CONSTRAINT brand_invitation_venue_capabilities_valid;
ALTER TABLE public.brand_invitation_venue_grants
  ADD CONSTRAINT brand_invitation_venue_capabilities_valid CHECK (
    capabilities <@ ARRAY[
      'stay.view_reservations',
      'stay.create_reservations',
      'stay.manage_reservations',
      'stay.view_availability',
      'restaurant.view_orders',
      'restaurant.manage_orders',
      'restaurant.manage_menu',
      'restaurant.manage_qr',
      'restaurant.manage_reservations',
      'venue.manage_offers',
      'venue.manage_bookings',
      'venue.view_bookings',
      'venue.check_in',
      'venue.manage_money'
    ]::text[]
  );
ALTER TABLE public.brand_team_member_venue_grants
  DROP CONSTRAINT brand_team_member_venue_capabilities_valid;
ALTER TABLE public.brand_team_member_venue_grants
  ADD CONSTRAINT brand_team_member_venue_capabilities_valid CHECK (
    capabilities <@ ARRAY[
      'stay.view_reservations',
      'stay.create_reservations',
      'stay.manage_reservations',
      'stay.view_availability',
      'restaurant.view_orders',
      'restaurant.manage_orders',
      'restaurant.manage_menu',
      'restaurant.manage_qr',
      'restaurant.manage_reservations',
      'venue.manage_offers',
      'venue.manage_bookings',
      'venue.view_bookings',
      'venue.check_in',
      'venue.manage_money'
    ]::text[]
  );

CREATE OR REPLACE FUNCTION public.issue_4188_has_venue_capability(
  p_venue_id uuid,
  p_user_id uuid,
  p_capability text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT p_user_id IS NOT NULL
    AND p_user_id = auth.uid()
    AND p_capability = ANY(ARRAY[
      'stay.view_reservations',
      'stay.create_reservations',
      'stay.manage_reservations',
      'stay.view_availability',
      'restaurant.view_orders',
      'restaurant.manage_orders',
      'restaurant.manage_menu',
      'restaurant.manage_qr',
      'restaurant.manage_reservations',
      'venue.manage_offers',
      'venue.manage_bookings',
      'venue.view_bookings',
      'venue.check_in',
      'venue.manage_money'
    ]::text[])
    AND EXISTS (
      SELECT 1
      FROM public.brand_team_members member
      JOIN public.brand_team_member_venue_grants grant_row
        ON grant_row.member_id = member.id
      JOIN public.venue_listings venue
        ON venue.id = grant_row.venue_id
       AND venue.brand_id = member.brand_id
      WHERE member.user_id = p_user_id
        AND member.role = 'venue_staff'
        AND member.accepted_at IS NOT NULL
        AND member.removed_at IS NULL
        AND grant_row.venue_id = p_venue_id
        AND p_capability = ANY(grant_row.capabilities)
    );
$function$;
REVOKE ALL ON FUNCTION public.issue_4188_has_venue_capability(uuid,uuid,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4188_has_venue_capability(uuid,uuid,text)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Constants and permission helpers.
-- ---------------------------------------------------------------------------
-- The fifteen feature keys, in the contract's order.
CREATE OR REPLACE FUNCTION public.issue_4490_feature_keys()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  SELECT ARRAY[
    'entry', 'group_packages', 'private_hire', 'by_the_hour',
    'table_reservations', 'floor_plan', 'pick_a_table', 'menu',
    'table_ordering', 'min_spend_tables', 'guest_list', 'memberships',
    'stays', 'events_here', 'waitlist'
  ]::text[];
$function$;

-- Direct parents (hard dependencies). private_hire and floor_plan also need an
-- active space (issue_4490_feature_needs_space). memberships has none.
CREATE OR REPLACE FUNCTION public.issue_4490_feature_parents(p_key text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  SELECT CASE p_key
    WHEN 'table_ordering' THEN ARRAY['menu']::text[]
    WHEN 'pick_a_table' THEN ARRAY['floor_plan']::text[]
    WHEN 'floor_plan' THEN ARRAY['table_reservations']::text[]
    WHEN 'min_spend_tables' THEN ARRAY['table_reservations']::text[]
    ELSE '{}'::text[]
  END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_feature_needs_space(p_key text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  SELECT p_key IN ('private_hire', 'floor_plan');
$function$;

-- Every feature that (transitively) requires p_key.
CREATE OR REPLACE FUNCTION public.issue_4490_feature_dependents(p_key text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  WITH RECURSIVE deps(k) AS (
    SELECT key FROM unnest(public.issue_4490_feature_keys()) AS key
    WHERE p_key = ANY(public.issue_4490_feature_parents(key))
    UNION
    SELECT key FROM deps, unnest(public.issue_4490_feature_keys()) AS key
    WHERE deps.k = ANY(public.issue_4490_feature_parents(key))
  )
  SELECT COALESCE(array_agg(k ORDER BY array_position(public.issue_4490_feature_keys(), k)), '{}'::text[])
  FROM deps;
$function$;

-- Every feature p_key (transitively) requires, nearest first.
CREATE OR REPLACE FUNCTION public.issue_4490_feature_ancestors(p_key text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  WITH RECURSIVE anc(k, depth) AS (
    SELECT parent, 1 FROM unnest(public.issue_4490_feature_parents(p_key)) AS parent
    UNION
    SELECT parent, anc.depth + 1 FROM anc, unnest(public.issue_4490_feature_parents(anc.k)) AS parent
  )
  SELECT COALESCE(array_agg(k ORDER BY depth DESC, k), '{}'::text[]) FROM anc;
$function$;

-- Features whose host and guest surfaces have shipped. Each phase widens this
-- list in the migration that ships the feature. A switch outside it cannot be
-- turned on, and the public page never shows it (reconciliation conflict 36).
CREATE OR REPLACE FUNCTION public.issue_4490_built_features()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  SELECT ARRAY['table_reservations', 'waitlist', 'menu', 'table_ordering', 'events_here', 'stays']::text[];
$function$;

-- Starting switches per venue type (spec 01 §4.1 as amended: club without
-- guest_list, stay = stays only).
CREATE OR REPLACE FUNCTION public.issue_4490_feature_preset(p_category text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  SELECT CASE p_category
    WHEN 'restaurant' THEN ARRAY['table_reservations', 'waitlist', 'menu', 'table_ordering']
    WHEN 'play' THEN ARRAY['entry', 'group_packages', 'private_hire', 'menu', 'events_here']
    WHEN 'creative_and_arts' THEN ARRAY['private_hire', 'by_the_hour', 'events_here']
    WHEN 'stay' THEN ARRAY['stays']
    WHEN 'bar_lounge' THEN ARRAY['table_reservations', 'min_spend_tables', 'private_hire', 'menu', 'events_here']
    WHEN 'club' THEN ARRAY['entry', 'table_reservations', 'min_spend_tables', 'events_here']
    WHEN 'cafe' THEN ARRAY['menu', 'table_ordering']
    WHEN 'event_space' THEN ARRAY['private_hire', 'events_here']
    WHEN 'coworking' THEN ARRAY['entry', 'by_the_hour', 'private_hire', 'memberships']
    ELSE NULL
  END::text[];
$function$;

-- Read: brand members, Mingla admins, and venue staff holding ANY venue.*
-- capability on this venue (reconciliation conflict 8).
CREATE OR REPLACE FUNCTION public.issue_4490_can_view_venue(p_venue_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.venue_listings venue
    WHERE venue.id = p_venue_id
      AND (
        public.biz_is_brand_member_for_read_for_caller(venue.brand_id)
        OR public.is_admin_user()
        OR EXISTS (
          SELECT 1
          FROM public.brand_team_members member
          JOIN public.brand_team_member_venue_grants grant_row
            ON grant_row.member_id = member.id
          WHERE member.user_id = auth.uid()
            AND auth.uid() IS NOT NULL
            AND member.brand_id = venue.brand_id
            AND member.role = 'venue_staff'
            AND member.accepted_at IS NOT NULL
            AND member.removed_at IS NULL
            AND grant_row.venue_id = venue.id
            AND EXISTS (
              SELECT 1 FROM unnest(grant_row.capabilities) AS capability
              WHERE capability LIKE 'venue.%'
            )
        )
      )
  );
$function$;

-- Write (spaces, hours, offers): brand rank >= event_manager, or the named
-- venue capability.
CREATE OR REPLACE FUNCTION public.issue_4490_can_manage_venue(p_venue_id uuid, p_capability text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.venue_listings venue
    WHERE venue.id = p_venue_id
      AND (
        public.biz_brand_effective_rank_for_caller(venue.brand_id) >= public.biz_role_rank('event_manager')
        OR public.issue_4188_has_venue_capability(venue.id, auth.uid(), p_capability)
      )
  );
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_assert_venue_brand()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.venue_listings venue
    WHERE venue.id = NEW.venue_id AND venue.brand_id = NEW.brand_id
  ) THEN
    RAISE EXCEPTION 'venue_brand_mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 5. Tables.
-- ---------------------------------------------------------------------------
CREATE TABLE public.venue_spaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES public.venue_listings(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  setting text NOT NULL DEFAULT 'indoor' CHECK (setting IN ('indoor', 'covered', 'outdoor')),
  capacity_standing integer NULL CHECK (capacity_standing BETWEEN 1 AND 100000),
  capacity_seated integer NULL CHECK (capacity_seated BETWEEN 1 AND 100000),
  photos jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(photos) = 'array' AND jsonb_array_length(photos) <= 12),
  plan_shape jsonb NULL CHECK (plan_shape IS NULL OR jsonb_typeof(plan_shape) = 'object'),
  plan_background_url text NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  archived_at timestamptz NULL,
  can_be_hired boolean NOT NULL DEFAULT true,
  step_free boolean NULL,
  amenities text[] NOT NULL DEFAULT '{}'::text[] CHECK (cardinality(amenities) <= 20),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  CONSTRAINT venue_spaces_capacity_present CHECK (capacity_standing IS NOT NULL OR capacity_seated IS NOT NULL),
  CONSTRAINT venue_spaces_archive_shape CHECK (archived_at IS NULL OR NOT is_active)
);
CREATE UNIQUE INDEX venue_spaces_venue_name_uniq
  ON public.venue_spaces (venue_id, lower(btrim(name))) WHERE archived_at IS NULL;
CREATE INDEX venue_spaces_venue_idx ON public.venue_spaces (venue_id, sort_order);
COMMENT ON TABLE public.venue_spaces IS
  '#4490: the rooms, floors, lawns and areas of a venue. Offers, hire and tables sit in spaces. Written only through issue_4490_manage_space.';

CREATE TABLE public.venue_space_combinations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES public.venue_listings(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  space_ids uuid[] NOT NULL CHECK (cardinality(space_ids) BETWEEN 2 AND 20),
  archived_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0)
);
CREATE UNIQUE INDEX venue_space_combinations_parts_uniq
  ON public.venue_space_combinations (venue_id, space_ids) WHERE archived_at IS NULL;
COMMENT ON TABLE public.venue_space_combinations IS
  '#4490: spaces hired together ("Whole Green" = two halves). Capacity is derived from the parts and never stored.';

CREATE TABLE public.venue_features (
  venue_id uuid NOT NULL REFERENCES public.venue_listings(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  feature_key text NOT NULL CHECK (feature_key IN (
    'entry', 'group_packages', 'private_hire', 'by_the_hour',
    'table_reservations', 'floor_plan', 'pick_a_table', 'menu',
    'table_ordering', 'min_spend_tables', 'guest_list', 'memberships',
    'stays', 'events_here', 'waitlist'
  )),
  enabled boolean NOT NULL DEFAULT false,
  space_ids uuid[] NULL,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(settings) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by uuid NULL,
  PRIMARY KEY (venue_id, feature_key)
);
COMMENT ON TABLE public.venue_features IS
  '#4490: the single home of whether a venue feature is on. venue_reservation_settings.reservations_enabled and venue_ordering_settings.ordering_enabled are mirrored both ways (issue_4490_set_venue_feature writes them; issue_4490_mirror_legacy_switch reads them back).';

-- Idempotent replays of #4490 writes (same key + same request = first result).
CREATE TABLE public.issue_4490_write_receipts (
  actor_user_id uuid NOT NULL,
  write_scope text NOT NULL,
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 8 AND 200),
  request_hash text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_user_id, write_scope, idempotency_key)
);

-- Triggers --------------------------------------------------------------------
CREATE TRIGGER issue_4490_venue_spaces_brand
  BEFORE INSERT OR UPDATE OF venue_id, brand_id ON public.venue_spaces
  FOR EACH ROW EXECUTE FUNCTION public.issue_4490_assert_venue_brand();
CREATE TRIGGER issue_4490_venue_space_combinations_brand
  BEFORE INSERT OR UPDATE OF venue_id, brand_id ON public.venue_space_combinations
  FOR EACH ROW EXECUTE FUNCTION public.issue_4490_assert_venue_brand();
CREATE TRIGGER issue_4490_venue_features_brand
  BEFORE INSERT OR UPDATE OF venue_id, brand_id ON public.venue_features
  FOR EACH ROW EXECUTE FUNCTION public.issue_4490_assert_venue_brand();

-- Space rows: trimmed name, well-formed photos, plan shape and amenities.
CREATE OR REPLACE FUNCTION public.issue_4490_assert_space_row()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  v_key text;
BEGIN
  NEW.name := btrim(NEW.name);
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(NEW.photos) AS photo
    WHERE jsonb_typeof(photo) <> 'object'
      OR jsonb_typeof(photo->'url') IS DISTINCT FROM 'string'
      OR char_length(btrim(photo->>'url')) NOT BETWEEN 1 AND 2048
      OR (photo ? 'alt' AND jsonb_typeof(photo->'alt') NOT IN ('string', 'null'))
  ) THEN
    RAISE EXCEPTION 'space_photos_invalid' USING ERRCODE = '22023';
  END IF;
  IF NEW.plan_shape IS NOT NULL THEN
    FOREACH v_key IN ARRAY ARRAY['x', 'y', 'w', 'h'] LOOP
      IF jsonb_typeof(NEW.plan_shape->v_key) IS DISTINCT FROM 'number'
         OR (NEW.plan_shape->>v_key)::numeric NOT BETWEEN 0 AND 1000 THEN
        RAISE EXCEPTION 'space_plan_invalid' USING ERRCODE = '22023';
      END IF;
    END LOOP;
    IF NEW.plan_shape ? 'rotation'
       AND (jsonb_typeof(NEW.plan_shape->'rotation') IS DISTINCT FROM 'number'
            OR (NEW.plan_shape->>'rotation')::numeric NOT BETWEEN -360 AND 360) THEN
      RAISE EXCEPTION 'space_plan_invalid' USING ERRCODE = '22023';
    END IF;
    IF NEW.plan_shape ? 'points' AND (
      jsonb_typeof(NEW.plan_shape->'points') IS DISTINCT FROM 'array'
      OR jsonb_array_length(NEW.plan_shape->'points') > 64
      OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(NEW.plan_shape->'points') AS point
        WHERE jsonb_typeof(point) <> 'array' OR jsonb_array_length(point) <> 2
          OR jsonb_typeof(point->0) <> 'number' OR jsonb_typeof(point->1) <> 'number'
          OR (point->>0)::numeric NOT BETWEEN 0 AND 1000
          OR (point->>1)::numeric NOT BETWEEN 0 AND 1000
      )
    ) THEN
      RAISE EXCEPTION 'space_plan_invalid' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(NEW.amenities) AS amenity
    WHERE amenity IS NULL OR char_length(btrim(amenity)) NOT BETWEEN 1 AND 40
  ) THEN
    RAISE EXCEPTION 'space_amenities_invalid' USING ERRCODE = '22023';
  END IF;
  NEW.amenities := ARRAY(
    SELECT DISTINCT ON (lower(btrim(amenity))) btrim(amenity)
    FROM unnest(NEW.amenities) WITH ORDINALITY AS a(amenity, ord)
    ORDER BY lower(btrim(amenity)), ord
  );
  RETURN NEW;
END;
$function$;
CREATE TRIGGER issue_4490_venue_spaces_shape
  BEFORE INSERT OR UPDATE ON public.venue_spaces
  FOR EACH ROW EXECUTE FUNCTION public.issue_4490_assert_space_row();

-- Combination parts: active spaces of the same venue, no duplicates, stored sorted.
CREATE OR REPLACE FUNCTION public.issue_4490_assert_combination_parts()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  NEW.name := btrim(NEW.name);
  IF NEW.archived_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.space_ids IS NULL
     OR array_position(NEW.space_ids, NULL) IS NOT NULL
     OR cardinality(ARRAY(SELECT DISTINCT unnest(NEW.space_ids))) <> cardinality(NEW.space_ids)
     OR EXISTS (
       SELECT 1 FROM unnest(NEW.space_ids) AS part
       WHERE NOT EXISTS (
         SELECT 1 FROM public.venue_spaces space
         WHERE space.id = part AND space.venue_id = NEW.venue_id
           AND space.is_active AND space.archived_at IS NULL
       )
     ) THEN
    RAISE EXCEPTION 'combination_parts_invalid' USING ERRCODE = '22023';
  END IF;
  NEW.space_ids := ARRAY(SELECT part FROM unnest(NEW.space_ids) AS part ORDER BY part);
  RETURN NEW;
END;
$function$;
CREATE TRIGGER issue_4490_venue_space_combinations_parts
  BEFORE INSERT OR UPDATE ON public.venue_space_combinations
  FOR EACH ROW EXECUTE FUNCTION public.issue_4490_assert_combination_parts();

-- Feature scope: NULL = every space; otherwise active spaces of the venue.
CREATE OR REPLACE FUNCTION public.issue_4490_assert_feature_spaces()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF NEW.space_ids IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.space_ids IS NOT DISTINCT FROM OLD.space_ids THEN
    RETURN NEW;
  END IF;
  IF array_position(NEW.space_ids, NULL) IS NOT NULL
     OR cardinality(ARRAY(SELECT DISTINCT unnest(NEW.space_ids))) <> cardinality(NEW.space_ids)
     OR EXISTS (
       SELECT 1 FROM unnest(NEW.space_ids) AS part
       WHERE NOT EXISTS (
         SELECT 1 FROM public.venue_spaces space
         WHERE space.id = part AND space.venue_id = NEW.venue_id
           AND space.is_active AND space.archived_at IS NULL
       )
     ) THEN
    RAISE EXCEPTION 'feature_space_ids_invalid' USING ERRCODE = '22023';
  END IF;
  NEW.space_ids := ARRAY(SELECT part FROM unnest(NEW.space_ids) AS part ORDER BY part);
  RETURN NEW;
END;
$function$;
CREATE TRIGGER issue_4490_venue_features_spaces
  BEFORE INSERT OR UPDATE OF space_ids ON public.venue_features
  FOR EACH ROW EXECUTE FUNCTION public.issue_4490_assert_feature_spaces();

-- RLS and grants -----------------------------------------------------------
ALTER TABLE public.venue_spaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.venue_space_combinations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.venue_features ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.issue_4490_write_receipts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "venue spaces readable by venue viewers"
  ON public.venue_spaces FOR SELECT TO authenticated
  USING (public.issue_4490_can_view_venue(venue_id));
CREATE POLICY "venue space combinations readable by venue viewers"
  ON public.venue_space_combinations FOR SELECT TO authenticated
  USING (public.issue_4490_can_view_venue(venue_id));
CREATE POLICY "venue features readable by venue viewers"
  ON public.venue_features FOR SELECT TO authenticated
  USING (public.issue_4490_can_view_venue(venue_id));

REVOKE ALL ON public.venue_spaces FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.venue_space_combinations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.venue_features FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.issue_4490_write_receipts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.venue_spaces TO authenticated;
GRANT SELECT ON public.venue_space_combinations TO authenticated;
GRANT SELECT ON public.venue_features TO authenticated;
GRANT ALL ON public.venue_spaces TO service_role;
GRANT ALL ON public.venue_space_combinations TO service_role;
GRANT ALL ON public.venue_features TO service_role;
GRANT ALL ON public.issue_4490_write_receipts TO service_role;

-- ---------------------------------------------------------------------------
-- 6. Idempotency receipts.
-- ---------------------------------------------------------------------------
-- Returns the first result for a replay, NULL for a new request; raises
-- 23505 offer_idempotency_conflict for the same key with a different request.
CREATE OR REPLACE FUNCTION public.issue_4490_receipt_lookup(
  p_write_scope text,
  p_idempotency_key text,
  p_request_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_receipt public.issue_4490_write_receipts%ROWTYPE;
BEGIN
  IF p_idempotency_key IS NULL OR char_length(btrim(p_idempotency_key)) NOT BETWEEN 8 AND 200 THEN
    RAISE EXCEPTION 'idempotency_key_invalid' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_uid::text || ':' || p_write_scope || ':' || btrim(p_idempotency_key), 4490)
  );
  SELECT * INTO v_receipt
  FROM public.issue_4490_write_receipts receipt
  WHERE receipt.actor_user_id = v_uid
    AND receipt.write_scope = p_write_scope
    AND receipt.idempotency_key = btrim(p_idempotency_key);
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF v_receipt.request_hash <> p_request_hash THEN
    RAISE EXCEPTION 'offer_idempotency_conflict' USING ERRCODE = '23505';
  END IF;
  RETURN v_receipt.result || jsonb_build_object('replayed', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_receipt_store(
  p_write_scope text,
  p_idempotency_key text,
  p_request_hash text,
  p_result jsonb
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $function$
  INSERT INTO public.issue_4490_write_receipts (actor_user_id, write_scope, idempotency_key, request_hash, result)
  VALUES (auth.uid(), p_write_scope, btrim(p_idempotency_key), p_request_hash, p_result);
$function$;

-- ---------------------------------------------------------------------------
-- 7. Feature state read.
-- ---------------------------------------------------------------------------
-- The effective rows for one venue: a stored row, or the backfill default when
-- a row is missing (a venue created before its rows existed reads the same
-- as one that has them).
CREATE OR REPLACE FUNCTION public.issue_4490_venue_feature_rows(p_venue_id uuid)
RETURNS TABLE (
  feature_key text,
  enabled boolean,
  space_ids uuid[],
  settings jsonb,
  version bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT
    key,
    COALESCE(feature.enabled, CASE key
      WHEN 'table_reservations' THEN COALESCE(reservation.reservations_enabled, false)
      WHEN 'waitlist' THEN COALESCE(reservation.reservations_enabled, false)
      WHEN 'menu' THEN venue.venue_category <> 'stay'
      WHEN 'table_ordering' THEN COALESCE(ordering.ordering_enabled, false)
      WHEN 'stays' THEN venue.venue_category = 'stay'
      ELSE false
    END),
    feature.space_ids,
    COALESCE(feature.settings, '{}'::jsonb),
    COALESCE(feature.version, 0)
  FROM public.venue_listings venue
  CROSS JOIN LATERAL unnest(public.issue_4490_feature_keys()) WITH ORDINALITY AS keys(key, ord)
  LEFT JOIN public.venue_features feature
    ON feature.venue_id = venue.id AND feature.feature_key = keys.key
  LEFT JOIN public.venue_reservation_settings reservation ON reservation.venue_id = venue.id
  LEFT JOIN public.venue_ordering_settings ordering ON ordering.venue_id = venue.id
  WHERE venue.id = p_venue_id
  ORDER BY keys.ord;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_venue_active_space_count(p_venue_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT count(*)::integer FROM public.venue_spaces space
  WHERE space.venue_id = p_venue_id AND space.is_active AND space.archived_at IS NULL;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_get_venue_features(p_venue_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_venue public.venue_listings%ROWTYPE;
  v_spaces integer;
  v_features jsonb;
  v_version bigint;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_venue FROM public.venue_listings WHERE id = p_venue_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'venue_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.issue_4490_can_view_venue(p_venue_id) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  v_spaces := public.issue_4490_venue_active_space_count(p_venue_id);

  WITH rows AS (
    SELECT * FROM public.issue_4490_venue_feature_rows(p_venue_id)
  )
  SELECT
    jsonb_agg(jsonb_build_object(
      'key', r.feature_key,
      'enabled', r.enabled,
      'space_ids', to_jsonb(r.space_ids),
      'settings', r.settings,
      'version', r.version,
      'blocked_by', to_jsonb(
        ARRAY(
          SELECT parent FROM unnest(public.issue_4490_feature_parents(r.feature_key)) AS parent
          WHERE NOT EXISTS (SELECT 1 FROM rows p WHERE p.feature_key = parent AND p.enabled)
        )
        || CASE WHEN public.issue_4490_feature_needs_space(r.feature_key) AND v_spaces = 0
             THEN ARRAY['space']::text[] ELSE '{}'::text[] END
      )
    ) ORDER BY array_position(public.issue_4490_feature_keys(), r.feature_key)),
    max(r.version)
  INTO v_features, v_version
  FROM rows r;

  RETURN jsonb_build_object(
    'venue_id', v_venue.id,
    'brand_id', v_venue.brand_id,
    'venue_category', v_venue.venue_category,
    'secondary_categories', to_jsonb(v_venue.secondary_categories),
    'version', COALESCE(v_version, 0),
    'active_space_count', v_spaces,
    'features', COALESCE(v_features, '[]'::jsonb),
    'flags', jsonb_build_object(
      'reads', COALESCE((SELECT flag.is_enabled FROM public.feature_flags flag WHERE flag.flag_key = 'VENUE_OFFERS_READS'), false),
      'writes', COALESCE((SELECT flag.is_enabled FROM public.feature_flags flag WHERE flag.flag_key = 'VENUE_OFFERS_WRITES'), false)
    )
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- 8. Feature writes and the legacy mirror.
-- ---------------------------------------------------------------------------
-- Writes one feature row (insert or update) and bumps its version. Internal.
CREATE OR REPLACE FUNCTION public.issue_4490_write_feature_row(
  p_venue_id uuid,
  p_key text,
  p_enabled boolean,
  p_space_ids uuid[],
  p_settings jsonb,
  p_keep_write_scope boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_brand uuid;
BEGIN
  SELECT brand_id INTO v_brand FROM public.venue_listings WHERE id = p_venue_id;
  INSERT INTO public.venue_features (venue_id, brand_id, feature_key, enabled, space_ids, settings, updated_by)
  VALUES (p_venue_id, v_brand, p_key, p_enabled, p_space_ids, COALESCE(p_settings, '{}'::jsonb), auth.uid())
  ON CONFLICT (venue_id, feature_key) DO UPDATE
    SET enabled = EXCLUDED.enabled,
        space_ids = CASE WHEN p_keep_write_scope THEN public.venue_features.space_ids ELSE EXCLUDED.space_ids END,
        settings = CASE WHEN p_settings IS NULL THEN public.venue_features.settings ELSE EXCLUDED.settings END,
        version = public.venue_features.version + 1,
        updated_at = now(),
        updated_by = auth.uid();
END;
$function$;

-- Writes the legacy switch for a mirrored feature, flagged so the reverse
-- trigger does not echo it back.
CREATE OR REPLACE FUNCTION public.issue_4490_write_legacy_switch(
  p_venue_id uuid,
  p_key text,
  p_enabled boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_venue public.venue_listings%ROWTYPE;
BEGIN
  IF p_key NOT IN ('table_reservations', 'table_ordering') THEN
    RETURN;
  END IF;
  SELECT * INTO v_venue FROM public.venue_listings WHERE id = p_venue_id;
  PERFORM pg_catalog.set_config('mingla.issue_4490_mirror', 'on', true);
  IF p_key = 'table_reservations' THEN
    UPDATE public.venue_reservation_settings
       SET reservations_enabled = p_enabled
     WHERE venue_id = p_venue_id AND reservations_enabled IS DISTINCT FROM p_enabled;
    IF NOT FOUND AND NOT EXISTS (
      SELECT 1 FROM public.venue_reservation_settings WHERE venue_id = p_venue_id
    ) THEN
      INSERT INTO public.venue_reservation_settings (venue_id, brand_id, place_pool_id, reservations_enabled)
      VALUES (p_venue_id, v_venue.brand_id, v_venue.place_pool_id, p_enabled);
    END IF;
  ELSE
    UPDATE public.venue_ordering_settings
       SET ordering_enabled = p_enabled
     WHERE venue_id = p_venue_id AND ordering_enabled IS DISTINCT FROM p_enabled;
    IF NOT FOUND AND NOT EXISTS (
      SELECT 1 FROM public.venue_ordering_settings WHERE venue_id = p_venue_id
    ) THEN
      INSERT INTO public.venue_ordering_settings (venue_id, brand_id, ordering_enabled)
      VALUES (p_venue_id, v_venue.brand_id, p_enabled);
    END IF;
  END IF;
  PERFORM pg_catalog.set_config('mingla.issue_4490_mirror', '', true);
END;
$function$;

-- Reverse mirror: an old Host build (or any other writer) changing the legacy
-- switch directly moves the feature too. Turning a switch on also turns on its
-- missing parents; turning it off also turns off what depends on it, so the
-- feature set never holds a child without its parent.
CREATE OR REPLACE FUNCTION public.issue_4490_mirror_legacy_switch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_key text;
  v_enabled boolean;
  v_old boolean;
  v_other text;
BEGIN
  IF COALESCE(pg_catalog.current_setting('mingla.issue_4490_mirror', true), '') = 'on' THEN
    RETURN NULL;
  END IF;
  IF TG_TABLE_NAME = 'venue_reservation_settings' THEN
    v_key := 'table_reservations';
    v_enabled := NEW.reservations_enabled;
    v_old := CASE WHEN TG_OP = 'UPDATE' THEN OLD.reservations_enabled END;
  ELSE
    v_key := 'table_ordering';
    v_enabled := NEW.ordering_enabled;
    v_old := CASE WHEN TG_OP = 'UPDATE' THEN OLD.ordering_enabled END;
  END IF;
  IF TG_OP = 'UPDATE' AND v_old IS NOT DISTINCT FROM v_enabled THEN
    RETURN NULL;
  END IF;
  -- A venue with no stored row reads the legacy column itself
  -- (issue_4490_venue_feature_rows), so only a stored row needs moving.
  IF EXISTS (
    SELECT 1 FROM public.venue_features
    WHERE venue_id = NEW.venue_id AND feature_key = v_key AND enabled IS DISTINCT FROM v_enabled
  ) THEN
    PERFORM public.issue_4490_write_feature_row(NEW.venue_id, v_key, v_enabled, NULL, NULL, true);
  END IF;
  IF v_enabled THEN
    FOREACH v_other IN ARRAY public.issue_4490_feature_ancestors(v_key) LOOP
      IF NOT EXISTS (
        SELECT 1 FROM public.issue_4490_venue_feature_rows(NEW.venue_id) r
        WHERE r.feature_key = v_other AND r.enabled
      ) THEN
        PERFORM public.issue_4490_write_feature_row(NEW.venue_id, v_other, true, NULL, NULL, true);
      END IF;
    END LOOP;
  ELSE
    FOREACH v_other IN ARRAY public.issue_4490_feature_dependents(v_key) LOOP
      IF EXISTS (
        SELECT 1 FROM public.venue_features
        WHERE venue_id = NEW.venue_id AND feature_key = v_other AND enabled
      ) THEN
        PERFORM public.issue_4490_write_feature_row(NEW.venue_id, v_other, false, NULL, NULL, true);
      END IF;
    END LOOP;
  END IF;
  RETURN NULL;
END;
$function$;

CREATE TRIGGER issue_4490_mirror_reservations_enabled
  AFTER INSERT OR UPDATE OF reservations_enabled ON public.venue_reservation_settings
  FOR EACH ROW EXECUTE FUNCTION public.issue_4490_mirror_legacy_switch();
CREATE TRIGGER issue_4490_mirror_ordering_enabled
  AFTER INSERT OR UPDATE OF ordering_enabled ON public.venue_ordering_settings
  FOR EACH ROW EXECUTE FUNCTION public.issue_4490_mirror_legacy_switch();

-- A category change to or from stay keeps a stored `stays` row in step (a
-- venue without stored rows derives `stays` from its category).
CREATE OR REPLACE FUNCTION public.issue_4490_sync_stays_feature()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NEW.venue_category IS DISTINCT FROM OLD.venue_category
     AND (NEW.venue_category = 'stay' OR OLD.venue_category = 'stay')
     AND EXISTS (
       SELECT 1 FROM public.venue_features
       WHERE venue_id = NEW.id AND feature_key = 'stays'
         AND enabled IS DISTINCT FROM (NEW.venue_category = 'stay')
     ) THEN
    PERFORM public.issue_4490_write_feature_row(NEW.id, 'stays', NEW.venue_category = 'stay', NULL, NULL, true);
  END IF;
  RETURN NULL;
END;
$function$;
CREATE TRIGGER issue_4490_sync_stays_feature
  AFTER UPDATE OF venue_category ON public.venue_listings
  FOR EACH ROW EXECUTE FUNCTION public.issue_4490_sync_stays_feature();

-- Switch one feature. Brand owner/admin only (reconciliation conflict 7).
-- p_cascade = true turns on missing parents (enabling) or turns off dependents
-- (disabling) in the same transaction; without it the call refuses.
CREATE OR REPLACE FUNCTION public.issue_4490_set_venue_feature(
  p_venue_id uuid,
  p_key text,
  p_enabled boolean,
  p_space_ids uuid[],
  p_settings jsonb,
  p_expected_version bigint,
  p_idempotency_key text,
  p_cascade boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_venue public.venue_listings%ROWTYPE;
  v_hash text;
  v_replay jsonb;
  v_current record;
  v_missing text[];
  v_dependents text[];
  v_changed text[] := '{}'::text[];
  v_other text;
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF p_key IS NULL OR NOT (p_key = ANY(public.issue_4490_feature_keys())) THEN
    RAISE EXCEPTION 'invalid_feature_key' USING ERRCODE = '22023';
  END IF;
  IF p_enabled IS NULL THEN
    RAISE EXCEPTION 'enabled_required' USING ERRCODE = '22023';
  END IF;
  IF p_settings IS NOT NULL AND jsonb_typeof(p_settings) <> 'object' THEN
    RAISE EXCEPTION 'feature_settings_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_venue FROM public.venue_listings WHERE id = p_venue_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'venue_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF public.biz_brand_effective_rank_for_caller(v_venue.brand_id) < public.biz_role_rank('brand_admin') THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  v_hash := encode(pg_catalog.sha256(convert_to(jsonb_build_object(
    'venue', p_venue_id, 'key', p_key, 'enabled', p_enabled, 'space_ids', to_jsonb(p_space_ids),
    'settings', p_settings, 'expected_version', p_expected_version, 'cascade', COALESCE(p_cascade, false)
  )::text, 'UTF8')), 'hex');
  v_replay := public.issue_4490_receipt_lookup('set_venue_feature:' || p_venue_id::text, p_idempotency_key, v_hash);
  IF v_replay IS NOT NULL THEN
    RETURN v_replay;
  END IF;

  IF p_key = 'stays' THEN
    RAISE EXCEPTION 'feature_managed:stays' USING ERRCODE = 'P0001';
  END IF;
  IF p_enabled AND NOT (p_key = ANY(public.issue_4490_built_features())) THEN
    RAISE EXCEPTION 'feature_not_available:%', p_key USING ERRCODE = 'P0001';
  END IF;

  -- One writer per venue's feature set at a time.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('issue_4490_features:' || p_venue_id::text, 4490));
  PERFORM 1 FROM public.venue_features WHERE venue_id = p_venue_id FOR UPDATE;

  SELECT * INTO v_current FROM public.issue_4490_venue_feature_rows(p_venue_id) r WHERE r.feature_key = p_key;
  IF p_expected_version IS NOT NULL AND p_expected_version <> v_current.version THEN
    RAISE EXCEPTION 'stale_write' USING ERRCODE = 'PT409';
  END IF;

  IF p_enabled THEN
    SELECT COALESCE(array_agg(parent ORDER BY ord), '{}'::text[]) INTO v_missing
    FROM unnest(public.issue_4490_feature_ancestors(p_key)) WITH ORDINALITY AS a(parent, ord)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.issue_4490_venue_feature_rows(p_venue_id) r
      WHERE r.feature_key = a.parent AND r.enabled
    );
    IF cardinality(v_missing) > 0 AND NOT COALESCE(p_cascade, false) THEN
      RAISE EXCEPTION 'feature_requires:%', array_to_string(v_missing, ',') USING ERRCODE = 'P0001';
    END IF;
    FOREACH v_other IN ARRAY v_missing || ARRAY[p_key] LOOP
      IF NOT (v_other = ANY(public.issue_4490_built_features())) THEN
        RAISE EXCEPTION 'feature_not_available:%', v_other USING ERRCODE = 'P0001';
      END IF;
      IF public.issue_4490_feature_needs_space(v_other)
         AND public.issue_4490_venue_active_space_count(p_venue_id) = 0 THEN
        RAISE EXCEPTION 'feature_requires:space' USING ERRCODE = 'P0001';
      END IF;
      -- Ordering money must never arrive where nobody is watching (#1791 OQ-7):
      -- the same verified-claim gate biz_venue_ordering_set_enabled applies.
      IF v_other = 'table_ordering' AND COALESCE(v_venue.claim_status, '') <> 'verified' THEN
        RAISE EXCEPTION 'venue_not_orderable' USING ERRCODE = 'P0001';
      END IF;
    END LOOP;
    FOREACH v_other IN ARRAY v_missing LOOP
      PERFORM public.issue_4490_write_feature_row(p_venue_id, v_other, true, NULL, NULL, true);
      PERFORM public.issue_4490_write_legacy_switch(p_venue_id, v_other, true);
      v_changed := v_changed || v_other;
    END LOOP;
  ELSE
    SELECT COALESCE(array_agg(child ORDER BY ord), '{}'::text[]) INTO v_dependents
    FROM unnest(public.issue_4490_feature_dependents(p_key)) WITH ORDINALITY AS d(child, ord)
    WHERE EXISTS (
      SELECT 1 FROM public.issue_4490_venue_feature_rows(p_venue_id) r
      WHERE r.feature_key = d.child AND r.enabled
    );
    IF cardinality(v_dependents) > 0 AND NOT COALESCE(p_cascade, false) THEN
      RAISE EXCEPTION 'feature_has_dependents:%', array_to_string(v_dependents, ',') USING ERRCODE = 'P0001';
    END IF;
    FOREACH v_other IN ARRAY v_dependents LOOP
      PERFORM public.issue_4490_write_feature_row(p_venue_id, v_other, false, NULL, NULL, true);
      PERFORM public.issue_4490_write_legacy_switch(p_venue_id, v_other, false);
      v_changed := v_changed || v_other;
    END LOOP;
  END IF;

  PERFORM public.issue_4490_write_feature_row(p_venue_id, p_key, p_enabled, p_space_ids, p_settings, false);
  PERFORM public.issue_4490_write_legacy_switch(p_venue_id, p_key, p_enabled);
  IF v_current.enabled IS DISTINCT FROM p_enabled THEN
    v_changed := v_changed || p_key;
  END IF;

  v_result := jsonb_build_object(
    'changed_keys', to_jsonb(v_changed),
    'features', public.issue_4490_get_venue_features(p_venue_id)
  );
  PERFORM public.issue_4490_receipt_store('set_venue_feature:' || p_venue_id::text, p_idempotency_key, v_hash, v_result);
  RETURN v_result || jsonb_build_object('replayed', false);
END;
$function$;

-- Turn on a venue type's starting switches. Never turns anything off.
CREATE OR REPLACE FUNCTION public.issue_4490_apply_feature_preset(
  p_venue_id uuid,
  p_category text,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_venue public.venue_listings%ROWTYPE;
  v_category text;
  v_preset text[];
  v_hash text;
  v_replay jsonb;
  v_key text;
  v_parent text;
  v_reason text;
  v_applied text[] := '{}'::text[];
  v_skipped jsonb := '[]'::jsonb;
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_venue FROM public.venue_listings WHERE id = p_venue_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'venue_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF public.biz_brand_effective_rank_for_caller(v_venue.brand_id) < public.biz_role_rank('brand_admin') THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  v_category := COALESCE(NULLIF(btrim(p_category), ''), v_venue.venue_category);
  v_preset := public.issue_4490_feature_preset(v_category);
  IF v_preset IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_category' USING ERRCODE = '22023';
  END IF;

  v_hash := encode(pg_catalog.sha256(convert_to(jsonb_build_object(
    'venue', p_venue_id, 'category', v_category)::text, 'UTF8')), 'hex');
  v_replay := public.issue_4490_receipt_lookup('apply_feature_preset:' || p_venue_id::text, p_idempotency_key, v_hash);
  IF v_replay IS NOT NULL THEN
    RETURN v_replay;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('issue_4490_features:' || p_venue_id::text, 4490));
  PERFORM 1 FROM public.venue_features WHERE venue_id = p_venue_id FOR UPDATE;

  FOREACH v_key IN ARRAY v_preset LOOP
    v_reason := NULL;
    IF EXISTS (
      SELECT 1 FROM public.issue_4490_venue_feature_rows(p_venue_id) r
      WHERE r.feature_key = v_key AND r.enabled
    ) THEN
      v_reason := 'already_on';
    ELSIF v_key = 'stays' THEN
      v_reason := 'managed_by_category';
    ELSIF NOT (v_key = ANY(public.issue_4490_built_features())) THEN
      v_reason := 'not_available_yet';
    ELSIF public.issue_4490_feature_needs_space(v_key)
          AND public.issue_4490_venue_active_space_count(p_venue_id) = 0 THEN
      v_reason := 'requires:space';
    ELSIF v_key = 'table_ordering' AND COALESCE(v_venue.claim_status, '') <> 'verified' THEN
      v_reason := 'venue_not_orderable';
    ELSE
      FOREACH v_parent IN ARRAY public.issue_4490_feature_parents(v_key) LOOP
        IF NOT EXISTS (
          SELECT 1 FROM public.issue_4490_venue_feature_rows(p_venue_id) r
          WHERE r.feature_key = v_parent AND r.enabled
        ) THEN
          v_reason := 'requires:' || v_parent;
          EXIT;
        END IF;
      END LOOP;
    END IF;

    IF v_reason IS NULL THEN
      PERFORM public.issue_4490_write_feature_row(p_venue_id, v_key, true, NULL, NULL, true);
      PERFORM public.issue_4490_write_legacy_switch(p_venue_id, v_key, true);
      v_applied := v_applied || v_key;
    ELSE
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('key', v_key, 'reason', v_reason));
    END IF;
  END LOOP;

  v_result := jsonb_build_object(
    'category', v_category,
    'applied', to_jsonb(v_applied),
    'skipped', v_skipped,
    'features', public.issue_4490_get_venue_features(p_venue_id)
  );
  PERFORM public.issue_4490_receipt_store('apply_feature_preset:' || p_venue_id::text, p_idempotency_key, v_hash, v_result);
  RETURN v_result || jsonb_build_object('replayed', false);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 9. Spaces and combinations.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_space_projection(p_space public.venue_spaces)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $function$
  SELECT jsonb_build_object(
    'id', p_space.id,
    'venue_id', p_space.venue_id,
    'name', p_space.name,
    'setting', p_space.setting,
    'capacity_standing', p_space.capacity_standing,
    'capacity_seated', p_space.capacity_seated,
    'photos', p_space.photos,
    'plan_shape', p_space.plan_shape,
    'plan_background_url', p_space.plan_background_url,
    'sort_order', p_space.sort_order,
    'is_active', p_space.is_active,
    'archived_at', p_space.archived_at,
    'can_be_hired', p_space.can_be_hired,
    'step_free', p_space.step_free,
    'amenities', to_jsonb(p_space.amenities),
    'version', p_space.version,
    'updated_at', p_space.updated_at
  );
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_manage_space(
  p_action text,
  p_venue_id uuid,
  p_payload jsonb,
  p_expected_version bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_venue public.venue_listings%ROWTYPE;
  v_space public.venue_spaces%ROWTYPE;
  v_payload jsonb := COALESCE(p_payload, '{}'::jsonb);
  v_id uuid;
  v_ids uuid[];
  v_amenities text[];
  v_needs text[];
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(v_payload) <> 'object' THEN
    RAISE EXCEPTION 'space_payload_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_venue FROM public.venue_listings WHERE id = p_venue_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'venue_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.issue_4490_can_manage_venue(p_venue_id, 'venue.manage_offers') THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF v_payload ? 'setting' AND COALESCE(v_payload->>'setting', '') NOT IN ('indoor', 'covered', 'outdoor') THEN
    RAISE EXCEPTION 'space_setting_invalid' USING ERRCODE = '22023';
  END IF;
  IF v_payload ? 'amenities' THEN
    IF jsonb_typeof(v_payload->'amenities') <> 'array'
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_payload->'amenities') a WHERE jsonb_typeof(a) <> 'string') THEN
      RAISE EXCEPTION 'space_amenities_invalid' USING ERRCODE = '22023';
    END IF;
    v_amenities := ARRAY(SELECT jsonb_array_elements_text(v_payload->'amenities'));
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('issue_4490_spaces:' || p_venue_id::text, 4490));

  BEGIN
    IF p_action = 'create' THEN
      INSERT INTO public.venue_spaces (
        venue_id, brand_id, name, setting, capacity_standing, capacity_seated, photos,
        plan_shape, plan_background_url, sort_order, can_be_hired, step_free, amenities
      ) VALUES (
        p_venue_id, v_venue.brand_id,
        COALESCE(v_payload->>'name', ''),
        COALESCE(v_payload->>'setting', 'indoor'),
        (v_payload->>'capacity_standing')::integer,
        (v_payload->>'capacity_seated')::integer,
        COALESCE(v_payload->'photos', '[]'::jsonb),
        CASE WHEN jsonb_typeof(v_payload->'plan_shape') = 'null' THEN NULL ELSE v_payload->'plan_shape' END,
        NULLIF(btrim(v_payload->>'plan_background_url'), ''),
        COALESCE((v_payload->>'sort_order')::integer,
          (SELECT COALESCE(max(s.sort_order) + 1, 0) FROM public.venue_spaces s
           WHERE s.venue_id = p_venue_id AND s.archived_at IS NULL)),
        COALESCE((v_payload->>'can_be_hired')::boolean, true),
        (v_payload->>'step_free')::boolean,
        COALESCE(v_amenities, '{}'::text[])
      ) RETURNING * INTO v_space;
      RETURN public.issue_4490_space_projection(v_space);

    ELSIF p_action = 'update' THEN
      v_id := (v_payload->>'id')::uuid;
      SELECT * INTO v_space FROM public.venue_spaces
      WHERE id = v_id AND venue_id = p_venue_id AND archived_at IS NULL FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'space_not_found' USING ERRCODE = 'P0002';
      END IF;
      IF p_expected_version IS NOT NULL AND p_expected_version <> v_space.version THEN
        RAISE EXCEPTION 'stale_write' USING ERRCODE = 'PT409';
      END IF;
      UPDATE public.venue_spaces SET
        name = CASE WHEN v_payload ? 'name' THEN COALESCE(v_payload->>'name', '') ELSE name END,
        setting = CASE WHEN v_payload ? 'setting' THEN v_payload->>'setting' ELSE setting END,
        capacity_standing = CASE WHEN v_payload ? 'capacity_standing' THEN (v_payload->>'capacity_standing')::integer ELSE capacity_standing END,
        capacity_seated = CASE WHEN v_payload ? 'capacity_seated' THEN (v_payload->>'capacity_seated')::integer ELSE capacity_seated END,
        photos = CASE WHEN v_payload ? 'photos' THEN COALESCE(v_payload->'photos', '[]'::jsonb) ELSE photos END,
        plan_shape = CASE WHEN v_payload ? 'plan_shape'
          THEN CASE WHEN jsonb_typeof(v_payload->'plan_shape') = 'null' THEN NULL ELSE v_payload->'plan_shape' END
          ELSE plan_shape END,
        plan_background_url = CASE WHEN v_payload ? 'plan_background_url' THEN NULLIF(btrim(v_payload->>'plan_background_url'), '') ELSE plan_background_url END,
        sort_order = CASE WHEN v_payload ? 'sort_order' THEN (v_payload->>'sort_order')::integer ELSE sort_order END,
        can_be_hired = CASE WHEN v_payload ? 'can_be_hired' THEN COALESCE((v_payload->>'can_be_hired')::boolean, true) ELSE can_be_hired END,
        step_free = CASE WHEN v_payload ? 'step_free' THEN (v_payload->>'step_free')::boolean ELSE step_free END,
        amenities = CASE WHEN v_payload ? 'amenities' THEN v_amenities ELSE amenities END,
        version = version + 1,
        updated_at = now()
      WHERE id = v_space.id
      RETURNING * INTO v_space;
      RETURN public.issue_4490_space_projection(v_space);

    ELSIF p_action = 'archive' THEN
      v_id := (v_payload->>'id')::uuid;
      SELECT * INTO v_space FROM public.venue_spaces
      WHERE id = v_id AND venue_id = p_venue_id AND archived_at IS NULL FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'space_not_found' USING ERRCODE = 'P0002';
      END IF;
      IF p_expected_version IS NOT NULL AND p_expected_version <> v_space.version THEN
        RAISE EXCEPTION 'stale_write' USING ERRCODE = 'PT409';
      END IF;
      -- The last active space cannot go while a feature needs a space.
      IF public.issue_4490_venue_active_space_count(p_venue_id) = 1 THEN
        SELECT COALESCE(array_agg(r.feature_key), '{}'::text[]) INTO v_needs
        FROM public.issue_4490_venue_feature_rows(p_venue_id) r
        WHERE r.enabled AND public.issue_4490_feature_needs_space(r.feature_key);
        IF cardinality(v_needs) > 0 THEN
          RAISE EXCEPTION 'space_in_use' USING ERRCODE = 'PT409';
        END IF;
      END IF;
      UPDATE public.venue_space_combinations
         SET archived_at = now(), version = version + 1, updated_at = now()
       WHERE venue_id = p_venue_id AND archived_at IS NULL AND v_space.id = ANY(space_ids);
      UPDATE public.venue_features
         SET space_ids = array_remove(space_ids, v_space.id), version = version + 1, updated_at = now(), updated_by = auth.uid()
       WHERE venue_id = p_venue_id AND v_space.id = ANY(space_ids);
      UPDATE public.venue_spaces
         SET archived_at = now(), is_active = false, version = version + 1, updated_at = now()
       WHERE id = v_space.id
      RETURNING * INTO v_space;
      RETURN public.issue_4490_space_projection(v_space);

    ELSIF p_action = 'reorder' THEN
      IF jsonb_typeof(v_payload->'ids') <> 'array' THEN
        RAISE EXCEPTION 'space_payload_invalid' USING ERRCODE = '22023';
      END IF;
      v_ids := ARRAY(SELECT (x)::uuid FROM jsonb_array_elements_text(v_payload->'ids') AS x);
      IF cardinality(ARRAY(SELECT DISTINCT unnest(v_ids))) <> cardinality(v_ids)
         OR EXISTS (
           SELECT 1 FROM unnest(v_ids) AS sid
           WHERE NOT EXISTS (
             SELECT 1 FROM public.venue_spaces s
             WHERE s.id = sid AND s.venue_id = p_venue_id AND s.archived_at IS NULL
           )
         ) THEN
        RAISE EXCEPTION 'space_payload_invalid' USING ERRCODE = '22023';
      END IF;
      UPDATE public.venue_spaces s
         SET sort_order = o.ord - 1, version = s.version + 1, updated_at = now()
        FROM unnest(v_ids) WITH ORDINALITY AS o(sid, ord)
       WHERE s.id = o.sid AND s.sort_order IS DISTINCT FROM (o.ord - 1)::integer;
      RETURN jsonb_build_object('spaces', COALESCE((
        SELECT jsonb_agg(public.issue_4490_space_projection(s) ORDER BY s.sort_order, s.created_at)
        FROM public.venue_spaces s WHERE s.venue_id = p_venue_id AND s.archived_at IS NULL
      ), '[]'::jsonb));
    ELSE
      RAISE EXCEPTION 'space_action_invalid' USING ERRCODE = '22023';
    END IF;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'space_name_taken' USING ERRCODE = 'PT409';
    WHEN check_violation THEN
      RAISE EXCEPTION 'space_invalid' USING ERRCODE = '22023';
    WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'space_payload_invalid' USING ERRCODE = '22023';
  END;
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_manage_space_combination(
  p_action text,
  p_venue_id uuid,
  p_payload jsonb,
  p_expected_version bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_venue public.venue_listings%ROWTYPE;
  v_combo public.venue_space_combinations%ROWTYPE;
  v_payload jsonb := COALESCE(p_payload, '{}'::jsonb);
  v_ids uuid[];
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_venue FROM public.venue_listings WHERE id = p_venue_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'venue_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.issue_4490_can_manage_venue(p_venue_id, 'venue.manage_offers') THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(v_payload) <> 'object'
     OR (v_payload ? 'space_ids' AND jsonb_typeof(v_payload->'space_ids') <> 'array') THEN
    RAISE EXCEPTION 'combination_payload_invalid' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('issue_4490_spaces:' || p_venue_id::text, 4490));

  BEGIN
    IF v_payload ? 'space_ids' THEN
      v_ids := ARRAY(SELECT (x)::uuid FROM jsonb_array_elements_text(v_payload->'space_ids') AS x);
    END IF;
    IF p_action = 'create' THEN
      INSERT INTO public.venue_space_combinations (venue_id, brand_id, name, space_ids)
      VALUES (p_venue_id, v_venue.brand_id, COALESCE(v_payload->>'name', ''), v_ids)
      RETURNING * INTO v_combo;
    ELSIF p_action IN ('update', 'archive') THEN
      SELECT * INTO v_combo FROM public.venue_space_combinations
      WHERE id = (v_payload->>'id')::uuid AND venue_id = p_venue_id AND archived_at IS NULL FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'combination_not_found' USING ERRCODE = 'P0002';
      END IF;
      IF p_expected_version IS NOT NULL AND p_expected_version <> v_combo.version THEN
        RAISE EXCEPTION 'stale_write' USING ERRCODE = 'PT409';
      END IF;
      IF p_action = 'update' THEN
        UPDATE public.venue_space_combinations SET
          name = CASE WHEN v_payload ? 'name' THEN COALESCE(v_payload->>'name', '') ELSE name END,
          space_ids = CASE WHEN v_payload ? 'space_ids' THEN v_ids ELSE space_ids END,
          version = version + 1,
          updated_at = now()
        WHERE id = v_combo.id
        RETURNING * INTO v_combo;
      ELSE
        UPDATE public.venue_space_combinations
           SET archived_at = now(), version = version + 1, updated_at = now()
         WHERE id = v_combo.id
        RETURNING * INTO v_combo;
      END IF;
    ELSE
      RAISE EXCEPTION 'combination_action_invalid' USING ERRCODE = '22023';
    END IF;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'combination_exists' USING ERRCODE = 'PT409';
    WHEN check_violation OR not_null_violation THEN
      RAISE EXCEPTION 'combination_parts_invalid' USING ERRCODE = '22023';
    WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'combination_payload_invalid' USING ERRCODE = '22023';
  END;

  RETURN jsonb_build_object(
    'id', v_combo.id,
    'venue_id', v_combo.venue_id,
    'name', v_combo.name,
    'space_ids', to_jsonb(v_combo.space_ids),
    'archived_at', v_combo.archived_at,
    'version', v_combo.version,
    'capacity_standing', (
      SELECT sum(s.capacity_standing) FROM public.venue_spaces s WHERE s.id = ANY(v_combo.space_ids)
    ),
    'capacity_seated', (
      SELECT sum(s.capacity_seated) FROM public.venue_spaces s WHERE s.id = ANY(v_combo.space_ids)
    )
  );
END;
$function$;

-- Grants (functions) -------------------------------------------------------
REVOKE ALL ON FUNCTION public.issue_4490_feature_keys() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.issue_4490_feature_parents(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.issue_4490_feature_needs_space(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.issue_4490_feature_dependents(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.issue_4490_feature_ancestors(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.issue_4490_built_features() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.issue_4490_feature_preset(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4490_feature_keys() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.issue_4490_feature_parents(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.issue_4490_feature_needs_space(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.issue_4490_feature_dependents(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.issue_4490_feature_ancestors(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.issue_4490_built_features() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.issue_4490_feature_preset(text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.issue_4490_can_view_venue(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4490_can_view_venue(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.issue_4490_can_manage_venue(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4490_can_manage_venue(uuid, text) TO authenticated, service_role;

-- Internal helpers: no client may call them.
REVOKE ALL ON FUNCTION public.issue_4490_assert_venue_brand() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_4490_assert_space_row() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_4490_assert_combination_parts() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_4490_assert_feature_spaces() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_4490_receipt_lookup(text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_4490_receipt_store(text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_4490_venue_feature_rows(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_4490_venue_active_space_count(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_4490_write_feature_row(uuid, text, boolean, uuid[], jsonb, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_4490_write_legacy_switch(uuid, text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_4490_mirror_legacy_switch() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_4490_sync_stays_feature() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_4490_space_projection(public.venue_spaces) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4490_venue_feature_rows(uuid) TO service_role;

-- Client RPCs: signed-in only; each checks its own authority.
REVOKE ALL ON FUNCTION public.issue_4490_get_venue_features(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4490_get_venue_features(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.issue_4490_set_venue_feature(uuid, text, boolean, uuid[], jsonb, bigint, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4490_set_venue_feature(uuid, text, boolean, uuid[], jsonb, bigint, text, boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.issue_4490_apply_feature_preset(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4490_apply_feature_preset(uuid, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.issue_4490_manage_space(text, uuid, jsonb, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4490_manage_space(text, uuid, jsonb, bigint) TO authenticated;
REVOKE ALL ON FUNCTION public.issue_4490_manage_space_combination(text, uuid, jsonb, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4490_manage_space_combination(text, uuid, jsonb, bigint) TO authenticated;

-- ---------------------------------------------------------------------------
-- 10. Backfill: one row per venue per key (reconciliation conflict 9: menu on
--     for every non-stay venue; the public Menu tab stays gated by items).
--     A venue still in pending review is skipped: its rows are derived (the
--     same values, issue_4490_venue_feature_rows) until a host writes one, so
--     #2099's pending-venue identity correction, which refuses any row in a
--     venue lane, keeps working for venues that have not used features yet.
-- ---------------------------------------------------------------------------
INSERT INTO public.venue_features (venue_id, brand_id, feature_key, enabled)
SELECT venue.id, venue.brand_id, key, CASE key
    WHEN 'table_reservations' THEN COALESCE(reservation.reservations_enabled, false)
    WHEN 'waitlist' THEN COALESCE(reservation.reservations_enabled, false)
    WHEN 'menu' THEN venue.venue_category <> 'stay'
    WHEN 'table_ordering' THEN COALESCE(ordering.ordering_enabled, false)
    WHEN 'stays' THEN venue.venue_category = 'stay'
    ELSE false
  END
FROM public.venue_listings venue
CROSS JOIN unnest(public.issue_4490_feature_keys()) AS key
LEFT JOIN public.venue_reservation_settings reservation ON reservation.venue_id = venue.id
LEFT JOIN public.venue_ordering_settings ordering ON ordering.venue_id = venue.id
WHERE venue.claim_status IS DISTINCT FROM 'pending_review'
ON CONFLICT (venue_id, feature_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 11. Two of the three in-function category validators (latest bodies, list
--     widened): biz_create_venue_listing from 20280521004334 (byte-identical
--     but the list and the comment) and issue_3386_identity_patch from
--     20270710013386 (list only). The third, correct_pending_venue_identity,
--     is widened by the #2099 pin owner 20281203054490 so its replay stays
--     idempotent.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.biz_create_venue_listing(p_brand_id uuid, p_name text, p_slug text, p_description text, p_google_place_id text, p_lat double precision, p_lng double precision, p_city text, p_country_code text, p_address text, p_venue_category text, p_contact_email text, p_contact_phone text, p_cover_media_url text, p_cover_media_type text, p_hours jsonb, p_place_pool_id uuid DEFAULT NULL::uuid, p_coordinate_precision text DEFAULT ''::text, p_theme_color text DEFAULT ''::text, p_theme_font text DEFAULT ''::text, p_theme_animation text DEFAULT ''::text, p_cover_media_poster_url text DEFAULT ''::text, p_location_place_id text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid;
  v_venue_id uuid;
  v_idx int;
  v_hour jsonb;
  v_cover_url text;
  v_cover_type text;
  v_cover_poster text;
  v_google text;
  v_pool_google text;
  v_coordinate_precision text;
  v_stay_authoring_enabled boolean := false;
  v_theme_color text;
  v_theme_font text;
  v_theme_animation text;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.brands b
    WHERE b.id = p_brand_id AND b.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'brand_not_found';
  END IF;
  IF public.biz_brand_effective_rank_for_caller(p_brand_id)
       < public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF length(trim(coalesce(p_name, ''))) = 0 THEN
    RAISE EXCEPTION 'name_required';
  END IF;
  IF length(trim(coalesce(p_slug, ''))) = 0 THEN
    RAISE EXCEPTION 'slug_required';
  END IF;
  IF trim(p_slug) !~ '^[a-z0-9]{1,32}$' THEN
    RAISE EXCEPTION 'invalid_slug';
  END IF;
  IF p_lat IS NULL OR p_lng IS NULL THEN
    RAISE EXCEPTION 'location_required';
  END IF;
  IF p_hours IS NULL OR jsonb_typeof(p_hours) <> 'array'
     OR jsonb_array_length(p_hours) <> 7 THEN
    RAISE EXCEPTION 'hours_must_have_7_rows';
  END IF;
  IF p_venue_category IS NULL OR p_venue_category NOT IN (
    'restaurant',
    'play',
    'creative_and_arts',
    'stay',
    'bar_lounge',
    'club',
    'cafe',
    'event_space',
    'coworking'
  ) THEN
    RAISE EXCEPTION 'invalid_venue_category';
  END IF;
  IF p_venue_category = 'stay' THEN
    SELECT COALESCE(flag.is_enabled, false)
    INTO v_stay_authoring_enabled
    FROM public.feature_flags flag
    WHERE flag.flag_key = 'STAY_VENUE_AUTHORING';
    IF NOT COALESCE(v_stay_authoring_enabled, false) THEN
      RAISE EXCEPTION 'stay_authoring_disabled';
    END IF;
  END IF;
  v_coordinate_precision := nullif(
    trim(coalesce(p_coordinate_precision, '')),
    ''
  );
  IF v_coordinate_precision IS NOT NULL
     AND v_coordinate_precision NOT IN ('exact', 'approximate') THEN
    v_coordinate_precision := NULL;
  END IF;
  -- issue #1564 — normalise each theme axis INDEPENDENTLY. A bad font must not
  -- discard a good colour: the axes inherit separately by design.
  v_theme_color := nullif(trim(coalesce(p_theme_color, '')), '');
  IF v_theme_color IS NOT NULL AND v_theme_color !~* '^#[0-9a-f]{6}$' THEN
    v_theme_color := NULL;
  END IF;
  v_theme_font := nullif(trim(coalesce(p_theme_font, '')), '');
  IF v_theme_font IS NOT NULL AND NOT public.issue_1023_is_theme_font(v_theme_font) THEN
    v_theme_font := NULL;
  END IF;
  v_theme_animation := nullif(trim(coalesce(p_theme_animation, '')), '');
  IF v_theme_animation IS NOT NULL AND v_theme_animation NOT IN (
    'none','confetti','fireworks','balloons','sparkles',
    'glitter_shower','snowfall','falling_petals','hearts','shimmer_reveal',
    -- issue #1023: the 20 new theme motion slugs
    'streamers',
    'party_shapes',
    'bubbles',
    'champagne',
    'disco_glints',
    'bokeh',
    'golden_dust',
    'neon_pulse',
    'autumn_leaves',
    'fireflies',
    'rain',
    'sun_rays',
    'starry_sky',
    'aurora',
    'lanterns',
    'embers',
    'music_notes',
    'love_burst',
    'rose_petals',
    'love_balloons'
  ) THEN
    v_theme_animation := NULL;
  END IF;
  v_google := nullif(trim(coalesce(p_google_place_id, '')), '');
  IF p_place_pool_id IS NOT NULL THEN
    SELECT p.google_place_id
    INTO v_pool_google
    FROM public.place_pool p
    WHERE p.id = p_place_pool_id AND p.is_active = true;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'place_pool_not_found';
    END IF;
    IF v_google IS NULL OR trim(v_pool_google) IS DISTINCT FROM v_google THEN
      RAISE EXCEPTION 'place_pool_google_place_id_mismatch';
    END IF;
  END IF;
  v_cover_url := nullif(trim(coalesce(p_cover_media_url, '')), '');
  v_cover_type := nullif(trim(coalesce(p_cover_media_type, '')), '');
  IF v_cover_type IS NOT NULL
     AND v_cover_type NOT IN ('image', 'video', 'gif') THEN
    RAISE EXCEPTION 'invalid_cover_media_type';
  END IF;
  IF v_cover_url IS NOT NULL AND v_cover_type IS NULL THEN
    RAISE EXCEPTION 'cover_media_type_required';
  END IF;
  IF v_cover_url IS NULL THEN
    v_cover_type := NULL;
  END IF;
  v_cover_poster := COALESCE(
    nullif(trim(coalesce(p_cover_media_poster_url, '')), ''),
    CASE WHEN v_cover_type = 'image' THEN v_cover_url END
  );
  PERFORM public.assert_cover_media_triplet(
    v_cover_url,
    v_cover_type,
    v_cover_poster
  );

  INSERT INTO public.venue_listings (
    brand_id,
    name,
    slug,
    address,
    google_place_id,
    place_pool_id,
    lat,
    lng,
    city,
    country_code,
    venue_category,
    contact_email,
    contact_phone,
    cover_media_url,
    cover_media_poster_url,
    cover_media_type,
    coordinate_precision,
    theme_color_override,
    theme_font_override,
    theme_animation_override,
    claim_status,
    location_provider_place_id
  ) VALUES (
    p_brand_id,
    trim(p_name),
    trim(p_slug),
    nullif(trim(coalesce(p_address, '')), ''),
    v_google,
    p_place_pool_id,
    p_lat,
    p_lng,
    nullif(trim(coalesce(p_city, '')), ''),
    nullif(trim(coalesce(p_country_code, '')), ''),
    p_venue_category,
    nullif(trim(coalesce(p_contact_email, '')), ''),
    nullif(trim(coalesce(p_contact_phone, '')), ''),
    v_cover_url,
    v_cover_poster,
    v_cover_type,
    v_coordinate_precision,
    v_theme_color,
    v_theme_font,
    v_theme_animation,
    'pending_review',
    public.places_checked_place_id(p_location_place_id)
  )
  RETURNING id INTO v_venue_id;

  FOR v_idx IN 0 .. 6 LOOP
    v_hour := p_hours -> v_idx;
    IF v_hour IS NULL THEN
      RAISE EXCEPTION 'missing_hour_index_%', v_idx;
    END IF;
    INSERT INTO public.brand_hours (
      brand_id,
      venue_id,
      weekday,
      open_time,
      close_time,
      is_closed
    ) VALUES (
      p_brand_id,
      v_venue_id,
      (v_hour ->> 'weekday')::smallint,
      CASE
        WHEN coalesce((v_hour ->> 'is_closed')::boolean, false) THEN NULL
        WHEN v_hour ->> 'open_time' IS NULL
          OR (v_hour ->> 'open_time') = '' THEN NULL
        ELSE (v_hour ->> 'open_time')::time
      END,
      CASE
        WHEN coalesce((v_hour ->> 'is_closed')::boolean, false) THEN NULL
        WHEN v_hour ->> 'close_time' IS NULL
          OR (v_hour ->> 'close_time') = '' THEN NULL
        ELSE (v_hour ->> 'close_time')::time
      END,
      coalesce((v_hour ->> 'is_closed')::boolean, false)
    );
  END LOOP;
  INSERT INTO public.brand_place_pipeline_state (
    brand_id,
    venue_id,
    place_pool_id,
    status,
    stage_status,
    readiness,
    coaching
  ) VALUES (
    p_brand_id,
    v_venue_id,
    p_place_pool_id,
    'draft',
    jsonb_build_object('tier1', 'created'),
    '{}'::jsonb,
    '[]'::jsonb
  )
  ON CONFLICT (venue_id) DO UPDATE
  SET place_pool_id = excluded.place_pool_id,
      status = excluded.status,
      stage_status =
        brand_place_pipeline_state.stage_status || excluded.stage_status,
      updated_at = now();
  PERFORM public.biz_derive_service_periods_from_brand_hours(v_venue_id);
  RETURN v_venue_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.biz_create_venue_listing(uuid, text, text, text, text, double precision, double precision, text, text, text, text, text, text, text, text, jsonb, uuid, text, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.biz_create_venue_listing(uuid, text, text, text, text, double precision, double precision, text, text, text, text, text, text, text, text, jsonb, uuid, text, text, text, text, text, text) TO authenticated, service_role;
COMMENT ON FUNCTION public.biz_create_venue_listing(uuid, text, text, text, text, double precision, double precision, text, text, text, text, text, text, text, text, jsonb, uuid, text, text, text, text, text, text) IS 'Issue #1463: event_manager+ may create pending-review venue listings for their own brand; publication and approval remain separately gated. Issue #1564: + p_theme_color/p_theme_font/p_theme_animation — the venue''s OWN theme, normalised per axis and fail-soft to NULL (inherit the brand) so a stale client can never block a submission over a colour. Issue #1719: the appended poster is validated and inserted atomically with URL/type. #4334: + p_location_place_id (DEFAULT NULL, so installed apps keep working) — the picked Google place id, written in the same statement as the coordinates. #4490: nine venue types (bar_lounge, club, cafe, event_space, coworking added); the type is a label and starting preset only.';


CREATE OR REPLACE FUNCTION public.issue_3386_identity_patch(
  p_venue public.venue_listings,
  p_name text,
  p_venue_category text,
  p_address text,
  p_city text,
  p_country_code text,
  p_lat double precision,
  p_lng double precision,
  p_coordinate_precision text
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_patch jsonb := '{}'::jsonb;
  v_name text;
  v_category text;
  v_address text;
  v_city text;
  v_country text;
  v_precision text;
BEGIN
  IF p_name IS NOT NULL THEN
    v_name := btrim(p_name);
    IF length(v_name) NOT BETWEEN 1 AND 80 THEN
      RAISE EXCEPTION 'invalid_name' USING ERRCODE = '22023';
    END IF;
    IF v_name IS DISTINCT FROM p_venue.name THEN
      v_patch := v_patch || jsonb_build_object('name', v_name);
    END IF;
  END IF;

  IF p_venue_category IS NOT NULL THEN
    v_category := btrim(p_venue_category);
    IF v_category NOT IN (
      'restaurant', 'play', 'creative_and_arts', 'stay',
      'bar_lounge', 'club', 'cafe', 'event_space', 'coworking'
    ) THEN
      RAISE EXCEPTION 'invalid_venue_category' USING ERRCODE = '22023';
    END IF;
    IF v_category IS DISTINCT FROM p_venue.venue_category THEN
      IF v_category = 'stay' OR p_venue.venue_category = 'stay' THEN
        RAISE EXCEPTION 'category_stay_change_not_supported' USING ERRCODE = '22023';
      END IF;
      v_patch := v_patch || jsonb_build_object('venue_category', v_category);
    END IF;
  END IF;

  IF p_address IS NULL THEN
    IF p_lat IS NOT NULL OR p_lng IS NOT NULL OR p_coordinate_precision IS NOT NULL
       OR p_city IS NOT NULL OR p_country_code IS NOT NULL THEN
      RAISE EXCEPTION 'address_required' USING ERRCODE = '22023';
    END IF;
  ELSE
    v_address := btrim(p_address);
    IF length(v_address) = 0 THEN
      RAISE EXCEPTION 'address_required' USING ERRCODE = '22023';
    END IF;
    IF p_lat IS NULL OR p_lng IS NULL THEN
      RAISE EXCEPTION 'address_location_required' USING ERRCODE = '22023';
    END IF;
    IF p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180
       OR p_lat = 'NaN'::double precision OR p_lng = 'NaN'::double precision THEN
      RAISE EXCEPTION 'invalid_location' USING ERRCODE = '22023';
    END IF;
    v_precision := btrim(coalesce(p_coordinate_precision, ''));
    IF v_precision NOT IN ('exact', 'approximate') THEN
      RAISE EXCEPTION 'invalid_coordinate_precision' USING ERRCODE = '22023';
    END IF;
    v_city := nullif(btrim(coalesce(p_city, '')), '');
    v_country := upper(btrim(coalesce(p_country_code, '')));
    IF v_country !~ '^[A-Z]{2}$' THEN
      v_country := NULL;
    END IF;
    IF v_address IS DISTINCT FROM p_venue.address
       OR v_city IS DISTINCT FROM p_venue.city
       OR v_country IS DISTINCT FROM p_venue.country_code
       OR p_lat IS DISTINCT FROM p_venue.lat
       OR p_lng IS DISTINCT FROM p_venue.lng
       OR v_precision IS DISTINCT FROM p_venue.coordinate_precision THEN
      v_patch := v_patch || jsonb_build_object('address', jsonb_build_object(
        'address', v_address,
        'city', v_city,
        'country_code', v_country,
        'lat', p_lat,
        'lng', p_lng,
        'coordinate_precision', v_precision
      ));
    END IF;
  END IF;

  RETURN v_patch;
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_3386_identity_patch(
  public.venue_listings, text, text, text, text, text, double precision, double precision, text
) FROM PUBLIC, anon, authenticated;



COMMIT;

-- Reverse (local use only; forward-fix in production):
--   DROP TABLE public.venue_features, public.venue_space_combinations, public.venue_spaces, public.issue_4490_write_receipts;
--   DROP TRIGGER issue_4490_mirror_reservations_enabled ON public.venue_reservation_settings;
--   DROP TRIGGER issue_4490_mirror_ordering_enabled ON public.venue_ordering_settings;
--   DROP TRIGGER issue_4490_sync_stays_feature ON public.venue_listings;
--   DROP FUNCTION public.issue_4490_* (every function this file creates);
--   ALTER TABLE public.venue_listings DROP COLUMN secondary_categories;
--   re-add the four-value category CHECKs (only if no new-category rows exist),
--   the nine-value capability CHECKs, and the 20280212004188 / 20280521004334 /
--   20270710013386 function bodies.

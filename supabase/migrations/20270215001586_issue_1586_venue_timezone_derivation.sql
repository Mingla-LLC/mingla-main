-- ===========================================================================
-- issue #1586 [timezone-backfill] — every venue's clock, derived from where the
-- venue actually is, and never guessed.
-- ---------------------------------------------------------------------------
-- THE DEFECT, restated as data. `venue_availability_config.iana_timezone` is
-- `text NOT NULL DEFAULT 'UTC'`. Every production row is sitting on that
-- default — including a restaurant in Raleigh, North Carolina. #1562 exposes
-- that column to the anonymous venue page so "open now" can be resolved in the
-- VENUE's zone; against `'UTC'` for a Raleigh venue the page would state a
-- confident answer that is four to five hours wrong, on the one screen whose
-- whole job is a first impression.
--
-- WHY CODE CANNOT FIX IT, AND WHAT ACTUALLY CAN. `'UTC'` is a LEGITIMATE zone —
-- London in winter, Accra, Reykjavik — so no client can treat it as "unset"
-- without lying about the venues that genuinely are UTC. The information that
-- is missing is not the VALUE, it is the PROVENANCE: did anyone ever establish
-- this venue's clock, or is this column still showing its own column default?
-- Nothing in the schema could answer that. `iana_timezone_source` (part 1) is
-- that answer, and it is what makes `'UTC'` safe forever:
--
--     'default'  — nobody ever established it. The column default is showing.
--                  The public view publishes NULL and the page claims NOTHING.
--     'derived'  — this migration's resolver worked it out from the venue's
--                  own coordinates. Re-derivable; a later pass may replace it.
--     'operator' — a human chose it. NEVER overwritten by derivation.
--
-- THE HARD CONSTRAINT — IANA ZONE NAMES, NEVER OFFSETS. #1562's resolver
-- (`packages/brand-rendering/venueOpenState.ts`, `isIanaZoneName`) refuses
-- `-05:00`, `+0500`, `Z` and every other offset shape outright, for two
-- independent and each-sufficient reasons: an offset cannot express DST
-- (`-05:00` IS New York in January and is an hour WRONG in July), and offset
-- acceptance is ICU-version-dependent, so one stored row would render "Open" on
-- web and "unknown" on a phone. `place_pool.utc_offset_minutes` already exists
-- in this database and is the obvious thing to reach for; deriving a zone from
-- it is exactly the defect this work exists to end. It is not consulted here.
-- Part 4's validator now enforces the SAME rule server-side that #1562 enforces
-- client-side, so a value that would blank the feature cannot be stored at all.
--
-- HOW DERIVATION WORKS, AND WHAT IT COSTS. A tz-boundary dataset
-- (timezone-boundary-builder) is tens of megabytes and there is no Postgres
-- extension on this project that resolves lat/lng to a zone — PostGIS 3.3.7 is
-- installed but ships no timezone geometry. Shipping a quadtree into the app
-- bundle was rejected outright: the eager web `__common` chunk has ~8.8 KB of
-- headroom (I-1047-BIZ-BUNDLE-BUDGET-DEFERRAL) and this is not client work.
--
-- So the resolver lives HERE, in the database, as reference DATA (part 2) plus
-- one function (part 3). That placement is what lets part 5's trigger make a
-- real zone unavoidable for venues that do not exist yet, and it costs the
-- client bundle exactly zero bytes.
--
-- The data is two tiers, and the second tier is the one that matters:
--
--   TIER 1 — WHOLE-COUNTRY ROWS, for countries the IANA database gives exactly
--            one zone. `NG → Africa/Lagos`, `GB → Europe/London`. This is not
--            an approximation; it is the mapping itself.
--   TIER 2 — RECTANGLES, for the multi-zone countries. Evaluated in priority
--            order, first hit wins.
--
-- AND THE THIRD OUTCOME, WHICH IS THE POINT. A rectangle whose `zone_name` is
-- NULL is a KNOWN-AMBIGUOUS region: the Indiana corners, the Kentucky and
-- Tennessee Eastern/Central corridors, the Florida panhandle line, the Navajo
-- Nation, Idaho, the Great Plains Central/Mountain corridor. Those rectangles
-- are hit FIRST and they resolve to NULL, so the derivation ABSTAINS rather
-- than pick a side. A point that matches no rectangle at all also abstains. An
-- abstention leaves `source = 'default'`, the view publishes NULL, and #1562
-- renders no time cell. Silence is the designed outcome; a guess never is.
--
-- WHAT THIS MIGRATION DOES NOT DO. It writes no offsets, adds no client
-- dependency, exposes no new column to `anon` beyond the one #1562 already
-- publishes, and overwrites no operator choice. It does not widen a grant.
--
-- MONOTONIC VERSION 20270215001586 — strictly above the current max
-- (20270214001564) across this worktree and every sibling under
-- ~/Desktop/mingla-orchs/*/supabase/migrations/. Idempotent: re-running is a
-- no-op (ADD COLUMN IF NOT EXISTS, CREATE TABLE IF NOT EXISTS, a DELETE+INSERT
-- reseed of reference rows, CREATE OR REPLACE throughout).
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. PROVENANCE. The column that makes 'UTC' safe.
-- ---------------------------------------------------------------------------
ALTER TABLE public.venue_availability_config
  ADD COLUMN IF NOT EXISTS iana_timezone_source text NOT NULL DEFAULT 'default';

DO $src_chk$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'venue_availability_config_tz_source_chk'
      AND conrelid = 'public.venue_availability_config'::regclass
  ) THEN
    ALTER TABLE public.venue_availability_config
      ADD CONSTRAINT venue_availability_config_tz_source_chk
      CHECK (iana_timezone_source IN ('default', 'derived', 'operator'));
  END IF;
END
$src_chk$;

COMMENT ON COLUMN public.venue_availability_config.iana_timezone_source IS
  'issue #1586: WHO established iana_timezone. ''default'' = nobody did and the '
  'column default (''UTC'') is showing — venue_public_view publishes NULL for '
  'these so the public page claims nothing. ''derived'' = worked out from the '
  'venue''s coordinates by public.derive_venue_iana_timezone. ''operator'' = a '
  'human chose it; derivation NEVER overwrites it. This column exists because '
  '''UTC'' is a legitimate zone (London in winter) and therefore cannot be read '
  'as "unset" — the missing information was provenance, not value.';

-- ---------------------------------------------------------------------------
-- 2. THE REFERENCE DATA. Whole-country rows + rectangles + abstention regions.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.venue_timezone_regions (
  id            bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  country_code  text NOT NULL,
  -- NULL is MEANINGFUL: a matched row with a NULL zone is a known-ambiguous
  -- region and the resolver abstains. It is not "no data"; it is "we know we
  -- cannot tell, and we refuse to guess".
  zone_name     text,
  min_lat       double precision,
  max_lat       double precision,
  min_lng       double precision,
  max_lng       double precision,
  -- NULL box = the whole country. Only ever used for single-zone countries.
  priority      integer NOT NULL DEFAULT 100,
  note          text NOT NULL,
  CONSTRAINT venue_timezone_regions_cc_chk CHECK (country_code ~ '^[A-Z]{2}$'),
  CONSTRAINT venue_timezone_regions_box_chk CHECK (
    (min_lat IS NULL AND max_lat IS NULL AND min_lng IS NULL AND max_lng IS NULL)
    OR (min_lat IS NOT NULL AND max_lat IS NOT NULL
        AND min_lng IS NOT NULL AND max_lng IS NOT NULL
        AND min_lat < max_lat AND min_lng < max_lng
        AND min_lat >= -90 AND max_lat <= 90
        AND min_lng >= -180 AND max_lng <= 180)
  )
);

CREATE INDEX IF NOT EXISTS venue_timezone_regions_lookup_idx
  ON public.venue_timezone_regions (country_code, priority, id);

-- Reference data with no user rows in it, but RLS on every table is the house
-- rule and there is no reason for any client to read it directly. Deny-all: no
-- policy, no grant. The resolver in part 3 is SECURITY DEFINER and is the only
-- reader.
ALTER TABLE public.venue_timezone_regions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.venue_timezone_regions FROM anon, authenticated;

COMMENT ON TABLE public.venue_timezone_regions IS
  'issue #1586: the lat/lng -> IANA ZONE NAME resolver''s data, in the database '
  'rather than the app bundle (a tz-boundary dataset is tens of MB; the eager '
  'web chunk has ~8.8 KB of headroom). Two tiers: a NULL box means the whole '
  'country and is only used where IANA gives that country exactly one zone; a '
  'box is a rectangle in a multi-zone country. A matched row with zone_name '
  'NULL is a KNOWN-AMBIGUOUS region and the resolver ABSTAINS. No offsets are '
  'stored, ever — see venueOpenState.isIanaZoneName for why.';

-- Reseed is DELETE + INSERT so the migration is idempotent and so correcting a
-- rectangle later is a data change with no code change.
DELETE FROM public.venue_timezone_regions;

-- ===== TIER 2a — UNITED STATES ============================================
-- Ordered most-specific first. The abstention rectangles are FIRST on purpose:
-- every one of them covers a place where the Eastern/Central or
-- Central/Mountain line runs THROUGH populated ground, and being silent there
-- is the whole design.
INSERT INTO public.venue_timezone_regions
  (country_code, zone_name, min_lat, max_lat, min_lng, max_lng, priority, note)
VALUES
  -- ABSTENTIONS (priority 10) --------------------------------------------
  ('US', NULL, 35.00, 37.05, -111.70, -109.00, 10,
   'Navajo Nation / Hopi Reservation, NE Arizona: Navajo observes DST, Hopi does not, and the Hopi enclave sits inside it. No rectangle can separate them.'),
  ('US', NULL, 40.55, 41.80, -87.55, -86.75, 10,
   'Indiana NW corner (Lake/Porter/LaPorte/Newton/Jasper) is Central while the rest of the state is Eastern.'),
  ('US', NULL, 37.75, 38.65, -88.10, -86.50, 10,
   'Indiana SW corner (Evansville and neighbours) is Central while the rest of the state is Eastern.'),
  ('US', NULL, 36.55, 38.15, -86.70, -85.20, 10,
   'Kentucky Eastern/Central corridor — the line runs north-south through the middle of the state (Louisville Eastern, Bowling Green Central).'),
  ('US', NULL, 34.95, 36.70, -85.90, -84.80, 10,
   'Tennessee Eastern/Central corridor (Chattanooga Eastern, Nashville Central).'),
  ('US', NULL, 29.40, 31.10, -85.70, -84.70, 10,
   'Florida panhandle Eastern/Central line at the Apalachicola River.'),
  ('US', NULL, 45.55, 47.00, -90.50, -87.20, 10,
   'Michigan Upper Peninsula western corridor — four counties are Central, the rest of Michigan is Eastern.'),
  ('US', NULL, 41.95, 49.05, -117.30, -110.99, 10,
   'Idaho — the northern panhandle is Pacific and the south is Mountain, split along the Salmon River rather than a line of longitude.'),
  -- Priority 30, NOT 10: this corridor exists to cover the plains states that
  -- have no rectangle of their own (the western Dakotas, the Nebraska
  -- panhandle, western Kansas). Colorado, Wyoming, Montana, New Mexico and the
  -- Texas panhandle DO have rectangles and are unambiguous inside them, so
  -- those must win — at priority 10 this corridor swallowed eastern Colorado
  -- and Amarillo and made them silent for no reason.
  ('US', NULL, 25.80, 49.05, -104.60, -101.00, 30,
   'Great Plains Central/Mountain corridor (western Dakotas, Nebraska panhandle, western Kansas) — the line follows county boundaries, not a meridian.'),
  ('US', NULL, 51.00, 55.00, -180.00, -169.00, 10,
   'Western Aleutians (America/Adak) are an hour behind the rest of Alaska.'),

  -- SPECIFIC SUB-STATE (priority 15) -------------------------------------
  ('US', 'America/Denver', 42.00, 44.30, -118.25, -116.90, 15,
   'Malheur County, Oregon — the one part of Oregon on Mountain time.'),
  ('US', 'America/Denver', 30.60, 32.10, -106.75, -104.85, 15,
   'Far-west Texas (El Paso and Hudspeth counties) on Mountain time.'),
  ('US', 'America/Puerto_Rico', 17.80, 18.60, -67.30, -65.20, 15,
   'Puerto Rico, when carried under a US country code.'),

  -- WHOLE-STATE, MOUNTAIN + ARIZONA (priority 18/19) ---------------------
  ('US', 'America/Phoenix', 31.30, 37.05, -114.85, -109.00, 18,
   'Arizona — Mountain offset with NO daylight saving, which is exactly why it needs its own zone name.'),
  ('US', 'America/Denver', 31.30, 37.05, -109.10, -103.05, 18,
   'New Mexico — east edge at the real state line so the Texas panhandle, which is Central, is not swept in.'),
  ('US', 'America/Chicago', 25.80, 36.55, -104.85, -101.00, 19,
   'Texas panhandle and west-central Texas (Amarillo, Lubbock, Midland) — Central, despite sitting inside the plains corridor longitudes.'),
  ('US', 'America/Denver', 36.98, 41.05, -109.10, -102.00, 20, 'Colorado.'),
  ('US', 'America/Denver', 40.95, 45.05, -111.10, -104.00, 20, 'Wyoming.'),
  ('US', 'America/Denver', 44.30, 49.05, -116.10, -103.98, 20, 'Montana.'),
  ('US', 'America/Denver', 36.95, 42.05, -114.10, -109.00, 20, 'Utah.'),

  -- WHOLE-STATE, PACIFIC (priority 20) -----------------------------------
  ('US', 'America/Los_Angeles', 41.98, 49.05, -124.90, -116.90, 20,
   'Washington and eastern/central Oregon.'),
  ('US', 'America/Los_Angeles', 32.50, 42.05, -124.50, -114.00, 20,
   'California and Nevada (Arizona is caught by its own rectangle first).'),

  -- NON-CONTIGUOUS (priority 25) -----------------------------------------
  ('US', 'America/Anchorage', 54.50, 71.50, -169.00, -129.90, 25,
   'Alaska mainland and southeast panhandle — one zone, DST-observing.'),
  ('US', 'Pacific/Honolulu', 18.80, 22.30, -160.30, -154.70, 25, 'Hawaii.'),

  -- BROAD BANDS (priority 35/40/50) --------------------------------------
  ('US', 'America/Chicago', 30.15, 36.70, -88.50, -85.90, 35,
   'Alabama, Mississippi, central and western Tennessee, western Florida panhandle — Central east of the main Central band.'),
  ('US', 'America/Chicago', 25.80, 49.05, -101.00, -87.60, 40,
   'The Central band: Texas through the Dakotas, east to the Illinois/Indiana line.'),
  ('US', 'America/New_York', 38.30, 47.60, -87.53, -85.90, 45,
   'Indiana, western Ohio and western Michigan — Eastern, but west of where the main Eastern band starts. Bounded south of 38.30 so the Kentucky side of the Ohio River is not swept in; the Indiana Central corners and the Michigan UP corridor are already excluded above.'),
  ('US', 'America/New_York', 24.40, 47.60, -85.90, -66.90, 50,
   'The Eastern band: the seaboard west to the Georgia/Alabama and Ohio/Indiana lines.');

-- ===== TIER 2b — OTHER MULTI-ZONE COUNTRIES ================================
-- Only countries whose zone map decomposes into rectangles WITHOUT a judgement
-- call. Every other multi-zone country (Russia, Kazakhstan, Mongolia, Chile,
-- Congo-Kinshasa, French Polynesia, Kiribati, Cyprus, Palestine) is seeded with
-- NOTHING and therefore abstains — adding one is a data change, not a code one.
INSERT INTO public.venue_timezone_regions
  (country_code, zone_name, min_lat, max_lat, min_lng, max_lng, priority, note)
VALUES
  -- Canada, by province. Not a live market; rectangles follow provincial
  -- borders, which the zone lines follow almost everywhere.
  ('CA', 'America/St_Johns', 46.50, 51.70,  -59.50,  -52.50, 20, 'Newfoundland.'),
  ('CA', 'America/Halifax',  43.30, 48.10,  -69.10,  -59.60, 20, 'Nova Scotia, New Brunswick, Prince Edward Island.'),
  ('CA', 'America/Toronto',  41.60, 56.00,  -90.00,  -59.70, 20, 'Ontario and Quebec.'),
  ('CA', 'America/Winnipeg', 48.90, 60.10, -102.10,  -89.00, 20, 'Manitoba.'),
  ('CA', 'America/Regina',   48.90, 60.10, -110.10, -101.30, 20, 'Saskatchewan — Central offset with NO daylight saving.'),
  ('CA', 'America/Edmonton', 48.90, 60.10, -120.10, -110.00, 20, 'Alberta.'),
  ('CA', 'America/Vancouver',48.20, 60.10, -139.10, -120.00, 20, 'British Columbia.'),

  -- Mexico. Nationwide DST ended in 2022; the remaining splits are the two
  -- Baja states, Sonora and Quintana Roo.
  ('MX', 'America/Tijuana',    28.00, 32.80, -118.50, -112.60, 15, 'Baja California (north) — the one Mexican state still on US Pacific rules.'),
  ('MX', 'America/Hermosillo', 26.00, 32.60, -115.10, -108.40, 18, 'Sonora — Mountain offset, no DST.'),
  ('MX', 'America/Cancun',     17.80, 21.70,  -89.30,  -86.70, 15, 'Quintana Roo.'),
  ('MX', 'America/Mexico_City',14.30, 32.80, -105.00,  -86.70, 40, 'The rest of Mexico.'),

  -- Brazil: the populated Atlantic band only. Every zone in it is UTC-3 with no
  -- DST, so one name serves the whole band. West of -50 abstains.
  ('BR', 'America/Sao_Paulo', -34.00, 5.30, -50.00, -34.00, 40,
   'Coastal and central-eastern Brazil — Sao Paulo, Rio, Brasilia, Salvador, Recife, Fortaleza, Belem, Porto Alegre. All UTC-3 with no DST.'),

  -- Spain and Portugal: mainland plus their Atlantic islands.
  ('ES', 'Atlantic/Canary', 27.50, 29.50, -18.30, -13.30, 15, 'Canary Islands.'),
  ('ES', 'Europe/Madrid',   35.90, 43.90,  -9.40,   4.40, 40, 'Mainland Spain and the Balearics.'),
  ('PT', 'Atlantic/Azores',  36.90, 39.80, -31.30, -24.90, 15, 'Azores.'),
  ('PT', 'Atlantic/Madeira', 32.40, 33.20, -17.30, -16.20, 15, 'Madeira.'),
  ('PT', 'Europe/Lisbon',    36.90, 42.20,  -9.60,  -6.10, 40, 'Mainland Portugal.'),

  -- Ecuador and Indonesia: clean longitude splits.
  ('EC', 'Pacific/Galapagos',  -1.50,  1.80, -92.10, -89.20, 15, 'Galapagos.'),
  ('EC', 'America/Guayaquil',  -5.10,  1.60, -81.10, -75.20, 40, 'Mainland Ecuador.'),
  ('ID', 'Asia/Jakarta',       -11.20, 6.20,  95.00, 115.00, 40, 'Western Indonesia (WIB).'),
  ('ID', 'Asia/Makassar',      -11.20, 4.80, 115.00, 135.00, 40, 'Central Indonesia (WITA).'),
  ('ID', 'Asia/Jayapura',      -11.20, 1.00, 135.00, 141.10, 40, 'Eastern Indonesia (WIT).'),

  -- Australia by state; the interior borders ARE the zone lines.
  ('AU', 'Australia/Perth',    -35.50, -13.50, 112.00, 129.00, 40, 'Western Australia.'),
  ('AU', 'Australia/Darwin',   -26.00, -10.90, 129.00, 138.10, 40, 'Northern Territory.'),
  ('AU', 'Australia/Adelaide', -38.20, -26.00, 129.00, 141.10, 40, 'South Australia.'),
  ('AU', 'Australia/Brisbane', -29.20, -10.60, 138.00, 153.60, 40, 'Queensland.'),
  ('AU', 'Australia/Sydney',   -37.60, -28.10, 141.00, 153.70, 40, 'New South Wales and the ACT.'),
  ('AU', 'Australia/Sydney',   -39.20, -33.90, 140.90, 150.10, 41, 'Victoria — same zone as New South Wales.'),
  ('AU', 'Australia/Hobart',   -43.80, -39.50, 143.80, 148.60, 20, 'Tasmania.'),

  -- New Zealand mainland. The Chatham Islands are their own zone and abstain.
  ('NZ', 'Pacific/Auckland', -47.50, -34.00, 166.00, 179.00, 40, 'New Zealand mainland.');

-- ===== TIER 1 — SINGLE-ZONE COUNTRIES ======================================
-- One zone per country in the IANA database, so a whole-country row is the
-- mapping itself rather than an approximation. NULL box = matches anywhere in
-- the country.
INSERT INTO public.venue_timezone_regions (country_code, zone_name, priority, note)
VALUES
  -- Africa
  ('DZ','Africa/Algiers',100,'single-zone country'),
  ('AO','Africa/Luanda',100,'single-zone country'),
  ('BJ','Africa/Porto-Novo',100,'single-zone country'),
  ('BW','Africa/Gaborone',100,'single-zone country'),
  ('BF','Africa/Ouagadougou',100,'single-zone country'),
  ('BI','Africa/Bujumbura',100,'single-zone country'),
  ('CM','Africa/Douala',100,'single-zone country'),
  ('CV','Atlantic/Cape_Verde',100,'single-zone country'),
  ('CF','Africa/Bangui',100,'single-zone country'),
  ('TD','Africa/Ndjamena',100,'single-zone country'),
  ('KM','Indian/Comoro',100,'single-zone country'),
  ('CG','Africa/Brazzaville',100,'single-zone country'),
  ('CI','Africa/Abidjan',100,'single-zone country'),
  ('DJ','Africa/Djibouti',100,'single-zone country'),
  ('EG','Africa/Cairo',100,'single-zone country'),
  ('GQ','Africa/Malabo',100,'single-zone country'),
  ('ER','Africa/Asmara',100,'single-zone country'),
  ('SZ','Africa/Mbabane',100,'single-zone country'),
  ('ET','Africa/Addis_Ababa',100,'single-zone country'),
  ('GA','Africa/Libreville',100,'single-zone country'),
  ('GM','Africa/Banjul',100,'single-zone country'),
  ('GH','Africa/Accra',100,'single-zone country'),
  ('GN','Africa/Conakry',100,'single-zone country'),
  ('GW','Africa/Bissau',100,'single-zone country'),
  ('KE','Africa/Nairobi',100,'single-zone country'),
  ('LS','Africa/Maseru',100,'single-zone country'),
  ('LR','Africa/Monrovia',100,'single-zone country'),
  ('LY','Africa/Tripoli',100,'single-zone country'),
  ('MG','Indian/Antananarivo',100,'single-zone country'),
  ('MW','Africa/Blantyre',100,'single-zone country'),
  ('ML','Africa/Bamako',100,'single-zone country'),
  ('MR','Africa/Nouakchott',100,'single-zone country'),
  ('MU','Indian/Mauritius',100,'single-zone country'),
  ('MA','Africa/Casablanca',100,'single-zone country'),
  ('MZ','Africa/Maputo',100,'single-zone country'),
  ('NA','Africa/Windhoek',100,'single-zone country'),
  ('NE','Africa/Niamey',100,'single-zone country'),
  ('NG','Africa/Lagos',100,'single-zone country'),
  ('RW','Africa/Kigali',100,'single-zone country'),
  ('ST','Africa/Sao_Tome',100,'single-zone country'),
  ('SN','Africa/Dakar',100,'single-zone country'),
  ('SC','Indian/Mahe',100,'single-zone country'),
  ('SL','Africa/Freetown',100,'single-zone country'),
  ('SO','Africa/Mogadishu',100,'single-zone country'),
  ('ZA','Africa/Johannesburg',100,'single-zone country'),
  ('SS','Africa/Juba',100,'single-zone country'),
  ('SD','Africa/Khartoum',100,'single-zone country'),
  ('TZ','Africa/Dar_es_Salaam',100,'single-zone country'),
  ('TG','Africa/Lome',100,'single-zone country'),
  ('TN','Africa/Tunis',100,'single-zone country'),
  ('UG','Africa/Kampala',100,'single-zone country'),
  ('ZM','Africa/Lusaka',100,'single-zone country'),
  ('ZW','Africa/Harare',100,'single-zone country'),
  -- Europe
  ('AL','Europe/Tirane',100,'single-zone country'),
  ('AD','Europe/Andorra',100,'single-zone country'),
  ('AT','Europe/Vienna',100,'single-zone country'),
  ('BY','Europe/Minsk',100,'single-zone country'),
  ('BE','Europe/Brussels',100,'single-zone country'),
  ('BA','Europe/Sarajevo',100,'single-zone country'),
  ('BG','Europe/Sofia',100,'single-zone country'),
  ('HR','Europe/Zagreb',100,'single-zone country'),
  ('CZ','Europe/Prague',100,'single-zone country'),
  ('DK','Europe/Copenhagen',100,'single-zone country'),
  ('EE','Europe/Tallinn',100,'single-zone country'),
  ('FI','Europe/Helsinki',100,'single-zone country'),
  ('FR','Europe/Paris',100,'single-zone country (metropolitan France)'),
  ('DE','Europe/Berlin',100,'single-zone country (Busingen shares Berlin''s clock)'),
  ('GI','Europe/Gibraltar',100,'single-zone country'),
  ('GR','Europe/Athens',100,'single-zone country'),
  ('HU','Europe/Budapest',100,'single-zone country'),
  ('IS','Atlantic/Reykjavik',100,'single-zone country'),
  ('IE','Europe/Dublin',100,'single-zone country'),
  ('IT','Europe/Rome',100,'single-zone country'),
  ('LV','Europe/Riga',100,'single-zone country'),
  ('LI','Europe/Vaduz',100,'single-zone country'),
  ('LT','Europe/Vilnius',100,'single-zone country'),
  ('LU','Europe/Luxembourg',100,'single-zone country'),
  ('MT','Europe/Malta',100,'single-zone country'),
  ('MD','Europe/Chisinau',100,'single-zone country'),
  ('MC','Europe/Monaco',100,'single-zone country'),
  ('ME','Europe/Podgorica',100,'single-zone country'),
  ('NL','Europe/Amsterdam',100,'single-zone country'),
  ('MK','Europe/Skopje',100,'single-zone country'),
  ('NO','Europe/Oslo',100,'single-zone country'),
  ('PL','Europe/Warsaw',100,'single-zone country'),
  ('RO','Europe/Bucharest',100,'single-zone country'),
  ('SM','Europe/San_Marino',100,'single-zone country'),
  ('RS','Europe/Belgrade',100,'single-zone country'),
  ('SK','Europe/Bratislava',100,'single-zone country'),
  ('SI','Europe/Ljubljana',100,'single-zone country'),
  ('SE','Europe/Stockholm',100,'single-zone country'),
  ('CH','Europe/Zurich',100,'single-zone country'),
  ('UA','Europe/Kyiv',100,'single-zone country'),
  ('GB','Europe/London',100,'single-zone country — and a LIVE Mingla market'),
  ('VA','Europe/Vatican',100,'single-zone country'),
  ('TR','Europe/Istanbul',100,'single-zone country'),
  -- Asia
  ('AF','Asia/Kabul',100,'single-zone country'),
  ('AM','Asia/Yerevan',100,'single-zone country'),
  ('AZ','Asia/Baku',100,'single-zone country'),
  ('BH','Asia/Bahrain',100,'single-zone country'),
  ('BD','Asia/Dhaka',100,'single-zone country'),
  ('BT','Asia/Thimphu',100,'single-zone country'),
  ('BN','Asia/Brunei',100,'single-zone country'),
  ('KH','Asia/Phnom_Penh',100,'single-zone country'),
  ('CN','Asia/Shanghai',100,'single-zone in practice — the whole country keeps Beijing time'),
  ('GE','Asia/Tbilisi',100,'single-zone country'),
  ('HK','Asia/Hong_Kong',100,'single-zone country'),
  ('IN','Asia/Kolkata',100,'single-zone country'),
  ('IR','Asia/Tehran',100,'single-zone country'),
  ('IQ','Asia/Baghdad',100,'single-zone country'),
  ('IL','Asia/Jerusalem',100,'single-zone country'),
  ('JP','Asia/Tokyo',100,'single-zone country'),
  ('JO','Asia/Amman',100,'single-zone country'),
  ('KW','Asia/Kuwait',100,'single-zone country'),
  ('KG','Asia/Bishkek',100,'single-zone country'),
  ('LA','Asia/Vientiane',100,'single-zone country'),
  ('LB','Asia/Beirut',100,'single-zone country'),
  ('MO','Asia/Macau',100,'single-zone country'),
  ('MY','Asia/Kuala_Lumpur',100,'single-zone country'),
  ('MV','Indian/Maldives',100,'single-zone country'),
  ('MM','Asia/Yangon',100,'single-zone country'),
  ('NP','Asia/Kathmandu',100,'single-zone country'),
  ('KP','Asia/Pyongyang',100,'single-zone country'),
  ('OM','Asia/Muscat',100,'single-zone country'),
  ('PK','Asia/Karachi',100,'single-zone country'),
  ('PH','Asia/Manila',100,'single-zone country'),
  ('QA','Asia/Qatar',100,'single-zone country'),
  ('SA','Asia/Riyadh',100,'single-zone country'),
  ('SG','Asia/Singapore',100,'single-zone country'),
  ('KR','Asia/Seoul',100,'single-zone country'),
  ('LK','Asia/Colombo',100,'single-zone country'),
  ('SY','Asia/Damascus',100,'single-zone country'),
  ('TW','Asia/Taipei',100,'single-zone country'),
  ('TJ','Asia/Dushanbe',100,'single-zone country'),
  ('TH','Asia/Bangkok',100,'single-zone country'),
  ('TL','Asia/Dili',100,'single-zone country'),
  ('TM','Asia/Ashgabat',100,'single-zone country'),
  ('AE','Asia/Dubai',100,'single-zone country'),
  ('UZ','Asia/Tashkent',100,'single-zone in practice — both Uzbek zones keep the same clock'),
  ('VN','Asia/Ho_Chi_Minh',100,'single-zone country'),
  ('YE','Asia/Aden',100,'single-zone country'),
  -- Americas
  ('AG','America/Antigua',100,'single-zone country'),
  ('AR','America/Argentina/Buenos_Aires',100,'every Argentine zone keeps UTC-3 with no DST'),
  ('AW','America/Aruba',100,'single-zone country'),
  ('BS','America/Nassau',100,'single-zone country'),
  ('BB','America/Barbados',100,'single-zone country'),
  ('BZ','America/Belize',100,'single-zone country'),
  ('BM','Atlantic/Bermuda',100,'single-zone country'),
  ('BO','America/La_Paz',100,'single-zone country'),
  ('CO','America/Bogota',100,'single-zone country'),
  ('CR','America/Costa_Rica',100,'single-zone country'),
  ('CU','America/Havana',100,'single-zone country'),
  ('DM','America/Dominica',100,'single-zone country'),
  ('DO','America/Santo_Domingo',100,'single-zone country'),
  ('SV','America/El_Salvador',100,'single-zone country'),
  ('GD','America/Grenada',100,'single-zone country'),
  ('GT','America/Guatemala',100,'single-zone country'),
  ('GY','America/Guyana',100,'single-zone country'),
  ('HT','America/Port-au-Prince',100,'single-zone country'),
  ('HN','America/Tegucigalpa',100,'single-zone country'),
  ('JM','America/Jamaica',100,'single-zone country'),
  ('NI','America/Managua',100,'single-zone country'),
  ('PA','America/Panama',100,'single-zone country'),
  ('PY','America/Asuncion',100,'single-zone country'),
  ('PE','America/Lima',100,'single-zone country'),
  ('PR','America/Puerto_Rico',100,'single-zone territory'),
  ('KN','America/St_Kitts',100,'single-zone country'),
  ('LC','America/St_Lucia',100,'single-zone country'),
  ('VC','America/St_Vincent',100,'single-zone country'),
  ('SR','America/Paramaribo',100,'single-zone country'),
  ('TT','America/Port_of_Spain',100,'single-zone country'),
  ('UY','America/Montevideo',100,'single-zone country'),
  ('VE','America/Caracas',100,'single-zone country'),
  ('VG','America/Tortola',100,'single-zone territory'),
  ('VI','America/St_Thomas',100,'single-zone territory'),
  ('KY','America/Cayman',100,'single-zone territory'),
  ('TC','America/Grand_Turk',100,'single-zone territory'),
  ('CW','America/Curacao',100,'single-zone territory'),
  ('GP','America/Guadeloupe',100,'single-zone territory'),
  ('MQ','America/Martinique',100,'single-zone territory'),
  ('GF','America/Cayenne',100,'single-zone territory'),
  -- Oceania
  ('FJ','Pacific/Fiji',100,'single-zone country'),
  ('WS','Pacific/Apia',100,'single-zone country'),
  ('TO','Pacific/Tongatapu',100,'single-zone country'),
  ('VU','Pacific/Efate',100,'single-zone country'),
  ('SB','Pacific/Guadalcanal',100,'single-zone country'),
  ('NC','Pacific/Noumea',100,'single-zone territory'),
  ('GU','Pacific/Guam',100,'single-zone territory'),
  ('MP','Pacific/Saipan',100,'single-zone territory'),
  ('PW','Pacific/Palau',100,'single-zone country'),
  ('CK','Pacific/Rarotonga',100,'single-zone territory'),
  ('NR','Pacific/Nauru',100,'single-zone country'),
  ('TV','Pacific/Funafuti',100,'single-zone country'),
  ('TK','Pacific/Fakaofo',100,'single-zone territory'),
  ('NU','Pacific/Niue',100,'single-zone territory'),
  ('WF','Pacific/Wallis',100,'single-zone territory');

-- SEED GUARD. Every non-NULL zone_name must be a zone this server actually
-- recognises, checked here rather than discovered when a venue page goes blank.
-- A typo aborts the migration.
DO $seed_guard$
DECLARE
  v_bad text;
  v_rows integer;
BEGIN
  SELECT count(*) INTO v_rows FROM public.venue_timezone_regions;
  -- Vacuity guard: an empty seed would make the name check below trivially
  -- pass and would leave the resolver silently abstaining on every venue.
  IF v_rows < 200 THEN
    RAISE EXCEPTION 'issue_1586_seed_too_small: venue_timezone_regions has % rows, expected 200+', v_rows;
  END IF;
  SELECT string_agg(DISTINCT r.zone_name, ', ') INTO v_bad
  FROM public.venue_timezone_regions r
  WHERE r.zone_name IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM pg_timezone_names n WHERE n.name = r.zone_name);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'issue_1586_unknown_zone_names: %', v_bad;
  END IF;
  -- No offsets, ever. Mirrors venueOpenState.isIanaZoneName: UTC/GMT, or
  -- Region/Location segments each starting with a letter. `Etc/GMT+5` is a
  -- REAL pg_timezone_names entry and is DST-blind, so it is refused too.
  SELECT string_agg(DISTINCT r.zone_name, ', ') INTO v_bad
  FROM public.venue_timezone_regions r
  WHERE r.zone_name IS NOT NULL
    AND (
      r.zone_name LIKE 'Etc/%'
      OR (r.zone_name NOT IN ('UTC', 'GMT')
          AND r.zone_name !~ '^[A-Za-z][A-Za-z0-9_+-]*(/[A-Za-z][A-Za-z0-9_+-]*)+$')
    );
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'issue_1586_non_iana_zone_names: %', v_bad;
  END IF;
END
$seed_guard$;

-- ---------------------------------------------------------------------------
-- 3. THE RESOLVER.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.derive_venue_iana_timezone(
  p_lat double precision,
  p_lng double precision,
  p_country_code text
) RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $derive$
DECLARE
  v_cc   text;
  v_zone text;
  v_hit  boolean;
BEGIN
  -- COORDINATES MUST BE USABLE. Anything else abstains; none of these is
  -- coerced to a default, because a default here is a wrong answer on a page
  -- whose whole job is a first impression.
  IF p_lat IS NULL OR p_lng IS NULL THEN RETURN NULL; END IF;
  IF p_lat < -90 OR p_lat > 90 OR p_lng < -180 OR p_lng > 180 THEN RETURN NULL; END IF;
  -- Null Island. `venue_listings.lat/lng` are NOT NULL, so an unknown location
  -- is written as a zero pair rather than left blank; treating it as a real
  -- point would put every such venue in the Gulf of Guinea.
  IF abs(p_lat) < 0.0001 AND abs(p_lng) < 0.0001 THEN RETURN NULL; END IF;

  -- COUNTRY. The rectangles are scoped per country, so without one there is
  -- nothing to scope to and the derivation abstains. Only the two aliases the
  -- pipeline actually produces are normalised; an unrecognised value abstains
  -- rather than being guessed at.
  v_cc := upper(btrim(coalesce(p_country_code, '')));
  v_cc := CASE v_cc
            WHEN 'USA' THEN 'US'
            WHEN 'UNITED STATES' THEN 'US'
            WHEN 'UK' THEN 'GB'
            WHEN 'UNITED KINGDOM' THEN 'GB'
            ELSE v_cc
          END;
  IF v_cc !~ '^[A-Z]{2}$' THEN RETURN NULL; END IF;

  -- FIRST MATCH WINS. A whole-country row (NULL box) matches anywhere; a
  -- rectangle matches when the point is inside it. `v_hit` is what separates
  -- "matched an ambiguous region, so abstain" from "matched nothing".
  SELECT r.zone_name, true INTO v_zone, v_hit
  FROM public.venue_timezone_regions r
  WHERE r.country_code = v_cc
    AND (
      r.min_lat IS NULL
      OR (p_lat >= r.min_lat AND p_lat <= r.max_lat
          AND p_lng >= r.min_lng AND p_lng <= r.max_lng)
    )
  ORDER BY r.priority, r.id
  LIMIT 1;

  IF v_hit IS NOT TRUE OR v_zone IS NULL THEN RETURN NULL; END IF;

  -- The server is the authority on which zones exist. A region row that named
  -- a zone this build does not carry abstains rather than storing a value the
  -- availability engine's `AT TIME ZONE` would reject.
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names n WHERE n.name = v_zone) THEN
    RETURN NULL;
  END IF;
  RETURN v_zone;
END
$derive$;

-- ---------------------------------------------------------------------------
-- GRANTS — I-PROPOSED-1392-NO-UNALLOWLISTED-ANON-DEFINER.
-- ---------------------------------------------------------------------------
-- `REVOKE ... FROM PUBLIC` alone is NOT enough on this database and the CI gate
-- proved it. Supabase's `ALTER DEFAULT PRIVILEGES ... GRANT ALL ON FUNCTIONS TO
-- anon, authenticated, service_role` writes an EXPLICIT per-role grant at
-- CREATE time, so a newly created function's ACL reads
-- `{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,...}`.
-- Revoking the PUBLIC pseudo-role leaves every one of those named grants
-- standing. The named roles must be revoked by name.
--
-- THIS FUNCTION IS NOT PUBLIC AND MUST NOT BE. It is an internal resolver. An
-- anonymous visitor has no reason to reach it, and allowlisting it would widen
-- the anon surface for a convenience nobody needs.
--
-- `authenticated` is revoked too, and the operator write path still works —
-- which is the property to check, because a REVOKE that breaks the thing it
-- protects is worse than the exposure. Every real caller reaches this function
-- through a SECURITY DEFINER boundary that is already owned by `postgres`:
--
--   * the backfill below runs as the migration role, which OWNS the function
--     and therefore never consults the ACL at all;
--   * `tg_venue_availability_config_validate_tz` is SECURITY DEFINER (made so
--     by this migration), so when an operator INSERTs or UPDATEs a config row
--     the nested call executes as the OWNER, not as `authenticated`.
--
-- Nothing in `mingla-business`, `app-mobile`, `mingla-admin` or any edge
-- function calls it directly, and no `supabase.rpc()` name matches it.
--
-- `service_role` keeps EXECUTE: it is the server-only key, it already bypasses
-- RLS, and a later re-derivation pass (after a country's rectangles are added,
-- say) should be runnable without a schema change. That grant adds nothing to
-- what `service_role` can already do.
--
-- Pinned by `issue_1586_venue_timezone_derivation.test.sql` T-13, which asserts
-- the exact grant set AND proves a role holding no EXECUTE still gets a derived
-- zone on INSERT.
REVOKE ALL ON FUNCTION public.derive_venue_iana_timezone(double precision, double precision, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.derive_venue_iana_timezone(double precision, double precision, text)
  TO service_role;

COMMENT ON FUNCTION public.derive_venue_iana_timezone(double precision, double precision, text) IS
  'issue #1586: a venue''s IANA ZONE NAME from its coordinates, or NULL. NEVER '
  'an offset and never place_pool.utc_offset_minutes — an offset cannot express '
  'DST, so it is wrong for half the year (see venueOpenState.isIanaZoneName). '
  'Returns NULL for missing/implausible coordinates, Null Island, an unknown '
  'country, and for a KNOWN-AMBIGUOUS region (the Indiana corners, the Kentucky '
  'and Tennessee Eastern/Central corridors, the Navajo Nation, Idaho, the Great '
  'Plains corridor). NULL means the page says nothing, which is the honest '
  'outcome; a guess never is.';

-- ---------------------------------------------------------------------------
-- 4/5. WRITE-TIME: derive on insert, refuse offsets, protect a human choice.
-- ---------------------------------------------------------------------------
-- Replaces the ORCH-1148 validator (20261008000000). That one normalised blank
-- to 'UTC' and checked pg_timezone_names. It still does both; it now also
-- DERIVES when nobody has established a zone, refuses the DST-blind names
-- #1562 would reject anyway, and records provenance.
CREATE OR REPLACE FUNCTION public.tg_venue_availability_config_validate_tz()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $tz$
DECLARE
  v_lat     double precision;
  v_lng     double precision;
  v_cc      text;
  v_derived text;
  v_explicit_source boolean;
BEGIN
  -- Did the writer SAY where this value came from? On INSERT, "yes" means the
  -- statement named a source other than the column default. On UPDATE, "yes"
  -- means the statement changed it. Everything below hangs off this, because
  -- it is what separates the backfill (which says 'derived') from a human
  -- edit through the picker (which says 'operator') from a bare UPDATE of the
  -- zone alone (which IS a human edit, and is stamped 'operator').
  IF TG_OP = 'INSERT' THEN
    v_explicit_source := NEW.iana_timezone_source IS DISTINCT FROM 'default';
  ELSE
    v_explicit_source := NEW.iana_timezone_source IS DISTINCT FROM OLD.iana_timezone_source;
  END IF;

  IF NEW.iana_timezone IS NULL OR btrim(NEW.iana_timezone) = '' THEN
    NEW.iana_timezone := 'UTC';
    IF NOT v_explicit_source THEN NEW.iana_timezone_source := 'default'; END IF;
  ELSE
    NEW.iana_timezone := btrim(NEW.iana_timezone);
  END IF;

  -- DERIVE when nobody has established one. The condition is deliberately
  -- narrow: the value is still the column's own default AND the writer did not
  -- name a source. A writer who explicitly wants UTC says so by setting
  -- iana_timezone_source = 'operator', which is exactly what the Availability
  -- module's picker does.
  IF NEW.iana_timezone = 'UTC' AND NOT v_explicit_source
     AND (TG_OP = 'INSERT' OR OLD.iana_timezone_source <> 'operator') THEN
    SELECT v.lat, v.lng, v.country_code INTO v_lat, v_lng, v_cc
    FROM public.venue_listings v WHERE v.id = NEW.venue_id;
    IF FOUND THEN
      v_derived := public.derive_venue_iana_timezone(v_lat, v_lng, v_cc);
    END IF;
    IF v_derived IS NOT NULL THEN
      NEW.iana_timezone := v_derived;
      NEW.iana_timezone_source := 'derived';
    ELSE
      -- Nothing derivable. Stay at the default and stay SILENT: the view
      -- publishes NULL for 'default' and the page claims nothing.
      NEW.iana_timezone_source := 'default';
    END IF;
  ELSIF TG_OP = 'UPDATE'
        AND NEW.iana_timezone IS DISTINCT FROM OLD.iana_timezone
        AND NOT v_explicit_source THEN
    -- Somebody changed the zone and did not say who. That is a human.
    NEW.iana_timezone_source := 'operator';
  ELSIF TG_OP = 'INSERT' AND NEW.iana_timezone <> 'UTC' AND NOT v_explicit_source THEN
    -- Inserted with a real zone already chosen — also a human.
    NEW.iana_timezone_source := 'operator';
  END IF;

  -- THE NAME RULE, server-side, mirroring venueOpenState.isIanaZoneName so a
  -- value that would blank the public page cannot be stored in the first place.
  -- Offsets never reach here (they are not in pg_timezone_names under those
  -- spellings), but `Etc/GMT+5` and the legacy single-token aliases (`EST`,
  -- `CET`, `Japan`, `Zulu`) ARE real pg_timezone_names entries, are DST-blind
  -- or non-canonical, and #1562 refuses every one of them.
  IF NEW.iana_timezone NOT IN ('UTC', 'GMT') THEN
    IF NEW.iana_timezone LIKE 'Etc/%'
       OR NEW.iana_timezone !~ '^[A-Za-z][A-Za-z0-9_+-]*(/[A-Za-z][A-Za-z0-9_+-]*)+$' THEN
      RAISE EXCEPTION 'venue_availability_config.iana_timezone "%" is not an IANA zone NAME — an offset or fixed-offset alias cannot express daylight saving and would render no time cell at all', NEW.iana_timezone
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = NEW.iana_timezone) THEN
    RAISE EXCEPTION 'venue_availability_config.iana_timezone "%" is not a recognised IANA timezone', NEW.iana_timezone
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$tz$;

-- The trigger must also fire when only iana_timezone_source moves (an operator
-- confirming the derived value) and on every INSERT, so it is no longer scoped
-- to `UPDATE OF iana_timezone` alone.
DROP TRIGGER IF EXISTS venue_availability_config_validate_tz ON public.venue_availability_config;
CREATE TRIGGER venue_availability_config_validate_tz
  BEFORE INSERT OR UPDATE OF iana_timezone, iana_timezone_source
  ON public.venue_availability_config
  FOR EACH ROW EXECUTE FUNCTION public.tg_venue_availability_config_validate_tz();

-- ---------------------------------------------------------------------------
-- 6. THE BACKFILL. Existing rows first, then venues that never got a row.
-- ---------------------------------------------------------------------------
-- Operator choices are excluded by predicate, not by trigger luck. `source`
-- is set EXPLICITLY to 'derived' in the same statement, which is what stops
-- the trigger from reading the backfill as a human edit.
UPDATE public.venue_availability_config c
SET iana_timezone = d.tz,
    iana_timezone_source = 'derived',
    updated_at = now()
FROM (
  SELECT c2.id AS cfg_id,
         public.derive_venue_iana_timezone(v.lat, v.lng, v.country_code) AS tz
  FROM public.venue_availability_config c2
  JOIN public.venue_listings v ON v.id = c2.venue_id
  WHERE c2.iana_timezone_source <> 'operator'
) d
WHERE c.id = d.cfg_id
  AND d.tz IS NOT NULL;

-- A venue with NO config row publishes NULL today and is therefore already
-- honest — but it also cannot ever show open-now. Give it a row when, and only
-- when, the zone is derivable. `service_periods` stays '[]' so this is inert
-- for reservations (the engine returns zero slots for an empty period list);
-- it exists purely to carry the clock.
INSERT INTO public.venue_availability_config (brand_id, venue_id, place_pool_id, iana_timezone, iana_timezone_source)
SELECT v.brand_id, v.id, v.place_pool_id,
       public.derive_venue_iana_timezone(v.lat, v.lng, v.country_code), 'derived'
FROM public.venue_listings v
WHERE NOT EXISTS (
        SELECT 1 FROM public.venue_availability_config c WHERE c.venue_id = v.id
      )
  AND public.derive_venue_iana_timezone(v.lat, v.lng, v.country_code) IS NOT NULL
ON CONFLICT (venue_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 7. THE VIEW. Reproduced in full from 20270214001564 with ONE expression
--    changed and nothing else: same 29 columns, same order, same joins, same
--    WHERE, same grants.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.venue_public_view AS
SELECT
  v.id, v.brand_id, b.slug AS brand_slug, b.name AS brand_name,
  v.slug, v.name, v.address, v.city, v.country_code, v.lat, v.lng,
  v.venue_category, v.google_place_id, v.contact_email, v.contact_phone,
  v.cover_media_url, v.cover_media_type, v.place_pool_id,
  -- issue #1564 — PER AXIS. The venue's own value when it has one, the brand's
  -- otherwise. Ordinals 19/20/21 and the `theme_*` names are unchanged, which
  -- is what keeps this a legal CREATE OR REPLACE and both `select("*")`
  -- by-name mappers untouched.
  COALESCE(v.theme_color_override, b.theme_color) AS theme_color,
  COALESCE(v.theme_font_override, b.theme_font) AS theme_font,
  COALESCE(v.theme_animation_override, b.theme_animation) AS theme_animation,
  b.cover_hue,
  b.default_currency,
  (SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'weekday', bh.weekday,
      'open_time', to_char(bh.open_time::interval, 'HH24:MI'),
      'close_time', to_char(bh.close_time::interval, 'HH24:MI'),
      'is_closed', bh.is_closed) ORDER BY bh.weekday), '[]'::jsonb)
     FROM public.brand_hours bh WHERE bh.venue_id = v.id) AS hours,
  pp.stored_photo_urls AS pool_photo_urls,
  -- META-ORCH-1290 M1 (D-6): the owner-authored pitch (generative_summary),
  -- anon-safe public-directory text on the already verified-only view.
  pp.generative_summary AS pitch,
  v.created_at, v.updated_at,
  -- issue #1562: the clock the `hours` column above is expressed in.
  -- issue #1586: GATED ON PROVENANCE. A row still sitting on the column's
  -- 'UTC' default was never established by anyone, and publishing it would
  -- have the page compute a confident open-now in UTC for a venue in Raleigh.
  -- 'UTC' is a real zone, so it cannot be filtered on VALUE — only on who put
  -- it there. NULL here is what makes #1562 render no time cell, which is its
  -- designed honest failure. Same ordinal, same name, same type.
  CASE WHEN vac.iana_timezone_source IN ('derived', 'operator')
       THEN vac.iana_timezone END AS iana_timezone
FROM public.venue_listings v
JOIN public.brands b ON b.id = v.brand_id AND b.deleted_at IS NULL
LEFT JOIN public.place_pool pp ON pp.id = v.place_pool_id
LEFT JOIN public.venue_availability_config vac ON vac.venue_id = v.id
WHERE v.claim_status = 'verified';

-- security_invoker stays FALSE (definer) per the 20260731000000 ruling —
-- explicit so a future default change cannot flip it, and load-bearing for the
-- availability-config join above.
ALTER VIEW public.venue_public_view SET (security_invoker = false);

GRANT SELECT ON public.venue_public_view TO anon, authenticated;

COMMENT ON VIEW public.venue_public_view IS
  'META-ORCH-1255 M4 (D-2): the ONLY anon read path for venue data '
  '(I-PROPOSED-1255-PUBLIC-VENUE-PAGE-ANON-SAFE). SECURITY DEFINER (20260731000000 '
  'ruling); WHERE claim_status=''verified'' + non-deleted brand scope the rows. '
  'pending_review/rejected/suspended/revoked venues are INVISIBLE here; no '
  'Stripe/account columns cross the view. Serves /b/{brandSlug}/v/{venueSlug}. '
  'META-ORCH-1290: + pitch (generative_summary), anon-safe public-directory text. '
  'issue #1562: + iana_timezone (venue_availability_config, LEFT JOIN, NULL-safe) — '
  'the clock the hours column is expressed in, so open-now can be resolved in the '
  'VENUE''s zone instead of the visitor''s device. ONE scalar crosses; no other '
  'availability-config column is exposed and no grant is widened. '
  'issue #1564: theme_color/theme_font/theme_animation are now resolved PER AXIS. '
  'issue #1586: iana_timezone is GATED on iana_timezone_source — a row still on '
  'the column''s ''UTC'' default publishes NULL, so a venue whose clock nobody '
  'ever established claims nothing instead of claiming UTC.';

COMMIT;

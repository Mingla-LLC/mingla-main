-- Issue #1704 — place_pool gets an ISO country code, and stops manufacturing a dirty one.
--
-- THE DEFECT. `place_pool.country` is free text and it is dirty: 'USA' (42,965),
-- 'UK' (15,548), 'US' (3), 'United Kingdom' (8), and rows reading
-- 'U0邮政编码: SE18 5NR' and 'USSet P邮政编码: 27545'. Nothing downstream can branch
-- on it, which is why a venue's phone number is dialled as bare local digits and
-- only connects if the caller happens to be standing in that country (#1703).
--
-- WHERE THE DIRT COMES FROM — us, not Google. `admin-seed-places/index.ts` at
-- lines 1000 and 1453:
--
--     transformGooglePlaceForSeed(p, batch.city_id,
--                                 parseCountry(p.formattedAddress, cityCountry), ...)
--
-- `cityCountry` is read from `seeding_cities` and is CLEAN — 17 rows, 8 countries,
-- every name spelled properly and every `country_code` already a valid ISO-3166-1
-- alpha-2. It is passed as the FALLBACK, and `parseCountry` (split the formatted
-- address on commas, take the last piece) WINS over it. We hold the right answer
-- and prefer a parsed one. The companion code change deletes `parseCountry` and
-- passes the clean value through; this migration repairs the history and makes the
-- correct value structurally hard to lose.
--
-- WHY A CODE AND NOT A CLEANED NAME. A name is prose: it has spellings, casings,
-- abbreviations and translations, so cleaning it once only resets the clock. An
-- ISO alpha-2 code has exactly one spelling, and the CHECK below means the column
-- cannot hold anything else. `seeding_cities.country_code` and
-- `venue_timezone_regions.country_code` already use this shape — this is the third
-- table joining an existing convention, not a new one.
--
-- WHY NOT ASK GOOGLE. `places.addressComponents` returns the ISO code directly and
-- sits in the Essentials SKU tier we already pay for on every call, so it would be
-- free. It is deliberately NOT used here: every row we hold can be resolved from
-- data already in this database, so a network dependency would buy nothing and add
-- a failure mode. Revisit only when we enter a country whose dialling convention
-- the code map below cannot express.
--
-- COVERAGE, probed read-only against production before this file was written
-- (88,411 rows total, including inactive):
--   tier 1  city_id -> seeding_cities.country_code ........... 88,118
--   tier 2  existing country text, normalised ................    292
--   tier 3  nearest seeded city by coordinates ..............       1
--   residue ..................................................       0
-- The one tier-3 row is 'Mingla QA Venue (Raleigh)', a fixture with a hardcoded
-- UUID, no address and no city_id, whose coordinates are Raleigh's. Tier 3 exists
-- so it and any future orphan resolve from geometry rather than by hand.


-- 1 ─ the column, and the constraint that keeps it honest.
ALTER TABLE public.place_pool
  ADD COLUMN IF NOT EXISTS country_code text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'place_pool_country_code_chk'
  ) THEN
    ALTER TABLE public.place_pool
      ADD CONSTRAINT place_pool_country_code_chk
      CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$');
  END IF;
END $$;

COMMENT ON COLUMN public.place_pool.country_code IS
  'Issue #1704: ISO-3166-1 alpha-2. THE country field to branch on. `country` is '
  'free-text prose kept for display only and must not be parsed. Populated by '
  'place_pool_fill_country_code_trg from city_id when a writer omits it.';


-- 2 ─ tier 1: the clean, curated join. 88,118 rows.
UPDATE public.place_pool pp
   SET country_code = sc.country_code
  FROM public.seeding_cities sc
 WHERE sc.id = pp.city_id
   AND pp.country_code IS NULL
   AND sc.country_code ~ '^[A-Z]{2}$';


-- 3 ─ tier 2: rows with no city_id but an unambiguous country string. 292 rows.
--     Only exact, unambiguous spellings are listed. Anything not in this map falls
--     through to tier 3 rather than being guessed at — the whole point of this
--     migration is that we stop inferring a country from prose.
UPDATE public.place_pool pp
   SET country_code = m.code
  FROM (VALUES
    ('USA','US'), ('US','US'), ('United States','US'),
    ('UK','GB'),  ('GB','GB'), ('United Kingdom','GB'),
    ('Nigeria','NG'), ('NG','NG'),
    ('Canada','CA'), ('CA','CA'),
    ('France','FR'), ('FR','FR'),
    ('Germany','DE'), ('DE','DE'),
    ('Belgium','BE'), ('BE','BE'),
    ('Spain','ES'), ('ES','ES'),
    ('Portugal','PT'), ('PT','PT')
  ) AS m(name, code)
 WHERE pp.country_code IS NULL
   AND btrim(pp.country) = m.name;


-- 4 ─ tier 3: nearest seeded city by great-circle distance, capped at 200 km.
--     The cap matters: without it a place anywhere on earth would silently adopt
--     the country of whichever of our 17 cities happened to be least far away.
--     200 km is comfortably wider than any of our seeded coverage radii and
--     narrower than the gap between any two of our markets.
-- (The LATERAL lives in a CTE, not in the UPDATE's FROM: an UPDATE target is not
--  a lateral-referenceable FROM entry, so the direct form fails to plan.)
WITH orphan AS (
  SELECT id, lat, lng
    FROM public.place_pool
   WHERE country_code IS NULL
     AND lat IS NOT NULL
     AND lng IS NOT NULL
),
matched AS (
  SELECT o.id, n.country_code
    FROM orphan o
    CROSS JOIN LATERAL (
      SELECT sc.country_code,
             6371 * 2 * asin(sqrt(
               sin(radians(sc.center_lat - o.lat) / 2) ^ 2
               + cos(radians(o.lat)) * cos(radians(sc.center_lat))
                 * sin(radians(sc.center_lng - o.lng) / 2) ^ 2
             )) AS km
        FROM public.seeding_cities sc
       WHERE sc.country_code ~ '^[A-Z]{2}$'
       ORDER BY km ASC
       LIMIT 1
    ) AS n
   WHERE n.km <= 200
)
UPDATE public.place_pool pp
   SET country_code = matched.country_code
  FROM matched
 WHERE matched.id = pp.id;


-- 5 ─ the backstop. A future writer that forgets country_code but sets city_id
--     still gets the right value; a writer that supplies one explicitly is never
--     overridden. This is what stops the column rotting the way `country` did.
CREATE OR REPLACE FUNCTION public.place_pool_fill_country_code()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NEW.country_code IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.city_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT sc.country_code INTO NEW.country_code
    FROM public.seeding_cities sc
   WHERE sc.id = NEW.city_id
     AND sc.country_code ~ '^[A-Z]{2}$';

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.place_pool_fill_country_code() IS
  'Issue #1704: derive place_pool.country_code from the seeded city when a writer '
  'omits it. Never overrides an explicitly supplied value.';

DROP TRIGGER IF EXISTS place_pool_fill_country_code_trg ON public.place_pool;
CREATE TRIGGER place_pool_fill_country_code_trg
  BEFORE INSERT OR UPDATE OF city_id, country_code ON public.place_pool
  FOR EACH ROW
  EXECUTE FUNCTION public.place_pool_fill_country_code();


-- 6 ─ an index only where a reader will actually use it: the phone-capable slice.
--     A full index on a 2-character column across 88k rows earns nothing.
CREATE INDEX IF NOT EXISTS idx_place_pool_country_code_with_phone
  ON public.place_pool (country_code)
  WHERE country_code IS NOT NULL AND national_phone_number IS NOT NULL;

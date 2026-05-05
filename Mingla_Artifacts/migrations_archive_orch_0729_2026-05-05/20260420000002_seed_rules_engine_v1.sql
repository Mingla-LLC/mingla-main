-- ═══════════════════════════════════════════════════════════════════════════════
-- ORCH-0526 M2 — Seed 18 rule sets from ai-verify-pipeline/index.ts constants
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- Idempotent: re-running this migration is safe — ON CONFLICT (name) DO NOTHING on
-- rule_sets makes the per-rule DO block skip cleanly if the rule already exists.
--
-- After all 18 are seeded:
--   1. rule_sets.current_version_id is set to point at v1 of each
--   2. rules_versions manifest 'v1-initial-seed' is created tying them together
--
-- Total entries: ~547 across 18 rule sets (FAST_FOOD ~65, EXCLUSION_KEYWORDS 15
-- sub-categories totalling ~150, CASUAL_CHAIN ~22, BLOCKED_PRIMARY ~22,
-- FLOWERS_BLOCKED_PRIMARY 10, FLOWERS_BLOCKED_SECONDARY 4, DELIVERY_ONLY 8,
-- GARDEN_STORE 19, CREATIVE_ARTS_BLOCKED ~50, MOVIES_THEATRE_BLOCKED ~50,
-- BRUNCH_CASUAL_BLOCKED ~30, PLAY_BLOCKED 12, RESTAURANT_TYPES ~55,
-- UPSCALE_CHAIN_PROTECTION 23, SOCIAL_DOMAINS 27, +3 zero-entry rules with
-- thresholds: MIN_DATA_GUARD, FINE_DINING_PROMOTION_T1, FINE_DINING_PROMOTION_T2)
--
-- Source of truth: supabase/functions/ai-verify-pipeline/index.ts lines 17-283 + 566-650
-- ═══════════════════════════════════════════════════════════════════════════════


-- ── Rule 1: FAST_FOOD_BLACKLIST (blacklist, global) ──────────────────────────

DO $$
DECLARE v_rule_id UUID; v_version_id UUID;
BEGIN
  INSERT INTO public.rule_sets (name, description, kind, scope_kind, scope_value)
  VALUES (
    'FAST_FOOD_BLACKLIST',
    'Fast-food / counter-service chains (name patterns) that never qualify as date venues',
    'blacklist', 'global', NULL
  )
  ON CONFLICT (name) DO NOTHING
  RETURNING id INTO v_rule_id;

  IF v_rule_id IS NOT NULL THEN
    INSERT INTO public.rule_set_versions (rule_set_id, version_number, change_summary)
    VALUES (v_rule_id, 1, 'Initial seed (ORCH-0526 M2) from ai-verify-pipeline/index.ts:19-35')
    RETURNING id INTO v_version_id;

    INSERT INTO public.rule_entries (rule_set_version_id, value, position, reason)
    SELECT v_version_id, val, ord, 'Seeded from code constant'
    FROM unnest(ARRAY[
      'mcdonald','burger king','kfc','kentucky fried','wendy''s','subway',
      'taco bell','chick-fil-a','five guys','popeyes','panda express',
      'domino''s','papa john','pizza hut','little caesar','sonic drive',
      'jack in the box','arby''s','carl''s jr','hardee','del taco',
      'raising cane','whataburger','in-n-out','wingstop','chipotle',
      'shake shack','checkers','rally''s','church''s chicken','el pollo loco',
      'golden corral','bojangles','cook out','zaxby',
      'panera bread','jersey mike','jimmy john','firehouse sub',
      'qdoba','potbelly','sweetgreen','tropical smoothie',
      'moe''s southwest','cava ',
      'starbucks','dunkin','tim horton','costa coffee','krispy kreme',
      'greggs','pret a manger','quick ','nordsee',
      'baskin-robbins','cold stone creamery','häagen-dazs','insomnia cookies',
      'crumbl','smoothie king','nothing bundt','rita''s italian ice',
      'jollibee','pollo tropical','pollo campero','telepizza'
    ]::text[]) WITH ORDINALITY AS t(val, ord);
  END IF;
END $$;


-- ── Rule 2: EXCLUSION_KEYWORDS (blacklist, global, 15 sub-categories) ───────

DO $$
DECLARE v_rule_id UUID; v_version_id UUID;
BEGIN
  INSERT INTO public.rule_sets (name, description, kind, scope_kind, scope_value)
  VALUES (
    'EXCLUSION_KEYWORDS',
    'Name + type keyword patterns by sub-category (medical/grooming/kids/etc.) that disqualify a place as a date venue',
    'blacklist', 'global', NULL
  )
  ON CONFLICT (name) DO NOTHING
  RETURNING id INTO v_rule_id;

  IF v_rule_id IS NOT NULL THEN
    INSERT INTO public.rule_set_versions (rule_set_id, version_number, change_summary)
    VALUES (v_rule_id, 1, 'Initial seed (ORCH-0526 M2) from ai-verify-pipeline/index.ts:37-90')
    RETURNING id INTO v_version_id;

    -- Sub-category: medical
    INSERT INTO public.rule_entries (rule_set_version_id, value, sub_category, position, reason)
    SELECT v_version_id, val, 'medical', ord, 'Seeded from code constant'
    FROM unnest(ARRAY[
      'hospital','clinic','dentist','doctor','pharmacy','chiropractor',
      'physiotherapy','veterinary','optometrist','urgent care'
    ]::text[]) WITH ORDINALITY AS t(val, ord);

    -- Sub-category: government
    INSERT INTO public.rule_entries (rule_set_version_id, value, sub_category, position, reason)
    SELECT v_version_id, val, 'government', ord, 'Seeded from code constant'
    FROM unnest(ARRAY[
      'dmv','courthouse','post office','police station','embassy','city hall','fire station'
    ]::text[]) WITH ORDINALITY AS t(val, ord);

    -- Sub-category: education
    INSERT INTO public.rule_entries (rule_set_version_id, value, sub_category, position, reason)
    SELECT v_version_id, val, 'education', ord, 'Seeded from code constant'
    FROM unnest(ARRAY[
      'school','daycare','preschool','tutoring','university campus'
    ]::text[]) WITH ORDINALITY AS t(val, ord);

    -- Sub-category: grooming
    INSERT INTO public.rule_entries (rule_set_version_id, value, sub_category, position, reason)
    SELECT v_version_id, val, 'grooming', ord, 'Seeded from code constant'
    FROM unnest(ARRAY[
      'threading','waxing studio','lash extension','microblading',
      'permanent makeup','nail salon','hair salon','barber',
      'kosmetikstudio','institut de beauté','beauty parlour',
      'tanning studio','brow bar','beauty salon','beauty lounge',
      'beauty world','beauty bar','med spa','medspa',
      'aesthetics spa','aesthetic clinic','beauty studio'
    ]::text[]) WITH ORDINALITY AS t(val, ord);

    -- Sub-category: fitness
    INSERT INTO public.rule_entries (rule_set_version_id, value, sub_category, position, reason)
    SELECT v_version_id, val, 'fitness', ord, 'Seeded from code constant'
    FROM unnest(ARRAY[
      'gym','fitness center','crossfit','yoga studio','pilates',
      'martial arts dojo','boxing gym'
    ]::text[]) WITH ORDINALITY AS t(val, ord);

    -- Sub-category: kids (ORCH-0460 expanded from 12 to 37 patterns)
    INSERT INTO public.rule_entries (rule_set_version_id, value, sub_category, position, reason)
    SELECT v_version_id, val, 'kids', ord, 'Seeded from code constant (ORCH-0460 expansion)'
    FROM unnest(ARRAY[
      'kids play','children''s','indoor playground','kidz','chuck e. cheese','kidzone',
      'enfants','kinder','bambini','infantil','splash pad','soft play',
      'toddler','baby','babies','bounce house','bouncy castle',
      'bounce ','bouncy','trampoline park','ball pit',
      'play center','play centre','playland','play land',
      'play zone','play world','play park','funland',
      'jungle gym','adventure playground','play space','playspace',
      'little ones','mommy and me','mommy & me','fun zone','funzone',
      'discovery zone','little explorers','tiny town','sensory play',
      'kids kingdom','imagination station'
    ]::text[]) WITH ORDINALITY AS t(val, ord);

    -- Sub-category: utilitarian
    INSERT INTO public.rule_entries (rule_set_version_id, value, sub_category, position, reason)
    SELECT v_version_id, val, 'utilitarian', ord, 'Seeded from code constant'
    FROM unnest(ARRAY[
      'gas station','car wash','laundromat','storage unit',
      'parking garage','auto repair','car dealership'
    ]::text[]) WITH ORDINALITY AS t(val, ord);

    -- Sub-category: delivery
    INSERT INTO public.rule_entries (rule_set_version_id, value, sub_category, position, reason)
    SELECT v_version_id, val, 'delivery', ord, 'Seeded from code constant'
    FROM unnest(ARRAY[
      'ghost kitchen','delivery only','cloud kitchen','virtual kitchen'
    ]::text[]) WITH ORDINALITY AS t(val, ord);

    -- Sub-category: food_truck
    INSERT INTO public.rule_entries (rule_set_version_id, value, sub_category, position, reason)
    SELECT v_version_id, val, 'food_truck', ord, 'Seeded from code constant'
    FROM unnest(ARRAY[
      'food truck','food cart','mobile kitchen'
    ]::text[]) WITH ORDINALITY AS t(val, ord);

    -- Sub-category: not_venue
    INSERT INTO public.rule_entries (rule_set_version_id, value, sub_category, position, reason)
    SELECT v_version_id, val, 'not_venue', ord, 'Seeded from code constant'
    FROM unnest(ARRAY[
      'real estate','insurance','accounting','law firm','consulting',
      'contractor','plumber','electrician','production company',
      'booking agency','talent agency','event management'
    ]::text[]) WITH ORDINALITY AS t(val, ord);

    -- Sub-category: gambling
    INSERT INTO public.rule_entries (rule_set_version_id, value, sub_category, position, reason)
    SELECT v_version_id, val, 'gambling', ord, 'Seeded from code constant'
    FROM unnest(ARRAY[
      'spielhalle','betting shop','slot machine','gambling hall'
    ]::text[]) WITH ORDINALITY AS t(val, ord);

    -- Sub-category: allotment
    INSERT INTO public.rule_entries (rule_set_version_id, value, sub_category, position, reason)
    SELECT v_version_id, val, 'allotment', ord, 'Seeded from code constant'
    FROM unnest(ARRAY[
      'kleingartenanlage','kleingarten','kolonie','schrebergarten',
      'allotment garden','jardin partagé','community garden','volkstuinen'
    ]::text[]) WITH ORDINALITY AS t(val, ord);

    -- Sub-category: sports_recreation (ORCH-0460)
    INSERT INTO public.rule_entries (rule_set_version_id, value, sub_category, position, reason)
    SELECT v_version_id, val, 'sports_recreation', ord, 'Seeded from code constant (ORCH-0460)'
    FROM unnest(ARRAY[
      'sports park','recreation center','rec center','recreation centre',
      'athletic center','athletic complex','sports complex',
      'community pool','public pool','sports field','ball field',
      'baseball field','softball field','soccer field','football field',
      'tennis center','swim center','aquatic center','fitness park',
      'sportplatz','polideportivo','centro deportivo','complexe sportif',
      'leisure centre','leisure center','recreation ground','sports ground',
      'playing field'
    ]::text[]) WITH ORDINALITY AS t(val, ord);

    -- Sub-category: community_civic (ORCH-0460)
    INSERT INTO public.rule_entries (rule_set_version_id, value, sub_category, position, reason)
    SELECT v_version_id, val, 'community_civic', ord, 'Seeded from code constant (ORCH-0460)'
    FROM unnest(ARRAY[
      'community center','community centre','civic center','civic centre',
      'recreation department','parks and recreation','parks & recreation',
      'senior center','senior centre','youth center','youth centre',
      'community hall','town hall','village hall','gemeindezentrum',
      'maison de quartier','centro comunitario','centre communautaire',
      'neighborhood center','neighbourhood centre'
    ]::text[]) WITH ORDINALITY AS t(val, ord);

    -- Sub-category: tobacco_hookah (ORCH-0460)
    INSERT INTO public.rule_entries (rule_set_version_id, value, sub_category, position, reason)
    SELECT v_version_id, val, 'tobacco_hookah', ord, 'Seeded from code constant (ORCH-0460)'
    FROM unnest(ARRAY[
      'tobacco','cigar lounge','cigar bar','hookah lounge',
      'shisha','shisha lounge','hookah cafe','nargile',
      'chicha','tabak','tabac'
    ]::text[]) WITH ORDINALITY AS t(val, ord);
  END IF;
END $$;


-- ── Rule 3: CASUAL_CHAIN_DEMOTION (demotion, category:upscale_fine_dining) ──

DO $$
DECLARE v_rule_id UUID; v_version_id UUID;
BEGIN
  INSERT INTO public.rule_sets (name, description, kind, scope_kind, scope_value)
  VALUES (
    'CASUAL_CHAIN_DEMOTION',
    'Sit-down chain restaurants that should be downgraded from upscale_fine_dining to brunch_lunch_casual when name matches',
    'demotion', 'category', 'upscale_fine_dining'
  )
  ON CONFLICT (name) DO NOTHING
  RETURNING id INTO v_rule_id;

  IF v_rule_id IS NOT NULL THEN
    INSERT INTO public.rule_set_versions (rule_set_id, version_number, change_summary, thresholds)
    VALUES (
      v_rule_id, 1,
      'Initial seed (ORCH-0526 M2) from ai-verify-pipeline/index.ts:92-94',
      '{"demote_to": "brunch_lunch_casual", "guarded_by": "UPSCALE_CHAIN_PROTECTION"}'::jsonb
    )
    RETURNING id INTO v_version_id;

    INSERT INTO public.rule_entries (rule_set_version_id, value, position, reason)
    SELECT v_version_id, val, ord, 'Seeded from code constant'
    FROM unnest(ARRAY[
      'olive garden','red lobster','outback','cheesecake factory',
      'applebee','chili''s','tgi friday','denny''s','ihop','waffle house',
      'cracker barrel','texas roadhouse','red robin','buffalo wild wings',
      'longhorn steakhouse','nando''s','wagamama','yo! sushi',
      'pizza express','pizzaexpress','hippopotamus'
    ]::text[]) WITH ORDINALITY AS t(val, ord);
  END IF;
END $$;


-- ── Rule 4: BLOCKED_PRIMARY_TYPES (blacklist, global) ───────────────────────

DO $$
DECLARE v_rule_id UUID; v_version_id UUID;
BEGIN
  INSERT INTO public.rule_sets (name, description, kind, scope_kind, scope_value)
  VALUES (
    'BLOCKED_PRIMARY_TYPES',
    'Google primary_type values that are never date venues — instant reject',
    'blacklist', 'global', NULL
  )
  ON CONFLICT (name) DO NOTHING
  RETURNING id INTO v_rule_id;

  IF v_rule_id IS NOT NULL THEN
    INSERT INTO public.rule_set_versions (rule_set_id, version_number, change_summary, thresholds)
    VALUES (
      v_rule_id, 1,
      'Initial seed (ORCH-0526 M2) from ai-verify-pipeline/index.ts:97-104',
      '{"check_field": "primary_type"}'::jsonb
    )
    RETURNING id INTO v_version_id;

    INSERT INTO public.rule_entries (rule_set_version_id, value, position, reason)
    SELECT v_version_id, val, ord, 'Seeded from code constant'
    FROM unnest(ARRAY[
      'cemetery','funeral_home','gas_station','car_dealer','car_wash',
      'car_rental','auto_repair','parking','storage','laundry',
      'locksmith','plumber','electrician','roofing_contractor',
      'insurance_agency','real_estate_agency','accounting',
      'post_office','fire_station','police','courthouse',
      'wedding_venue','banquet_hall'
    ]::text[]) WITH ORDINALITY AS t(val, ord);
  END IF;
END $$;


-- ── Rule 5: FLOWERS_BLOCKED_PRIMARY_TYPES (strip, category:flowers) ─────────

DO $$
DECLARE v_rule_id UUID; v_version_id UUID;
BEGIN
  INSERT INTO public.rule_sets (name, description, kind, scope_kind, scope_value)
  VALUES (
    'FLOWERS_BLOCKED_PRIMARY_TYPES',
    'Strip the flowers category if primary_type matches (broad list — used for primary_type checks)',
    'strip', 'category', 'flowers'
  )
  ON CONFLICT (name) DO NOTHING
  RETURNING id INTO v_rule_id;

  IF v_rule_id IS NOT NULL THEN
    INSERT INTO public.rule_set_versions (rule_set_id, version_number, change_summary, thresholds)
    VALUES (
      v_rule_id, 1,
      'Initial seed (ORCH-0526 M2) from ai-verify-pipeline/index.ts:117-120',
      '{"check_field": "primary_type"}'::jsonb
    )
    RETURNING id INTO v_version_id;

    INSERT INTO public.rule_entries (rule_set_version_id, value, position, reason)
    SELECT v_version_id, val, ord, 'Seeded from code constant'
    FROM unnest(ARRAY[
      'garden_center','garden','farm','supplier','cemetery','funeral_home',
      'restaurant','meal_takeaway','bar','food_store'
    ]::text[]) WITH ORDINALITY AS t(val, ord);
  END IF;
END $$;


-- ── Rule 6: FLOWERS_BLOCKED_SECONDARY_TYPES (strip, category:flowers) ──────

DO $$
DECLARE v_rule_id UUID; v_version_id UUID;
BEGIN
  INSERT INTO public.rule_sets (name, description, kind, scope_kind, scope_value)
  VALUES (
    'FLOWERS_BLOCKED_SECONDARY_TYPES',
    'Strip the flowers category if any TYPES-ARRAY entry matches (TIGHT list — avoids supermarket false-positives that ORCH-0460 v1 caused)',
    'strip', 'category', 'flowers'
  )
  ON CONFLICT (name) DO NOTHING
  RETURNING id INTO v_rule_id;

  IF v_rule_id IS NOT NULL THEN
    INSERT INTO public.rule_set_versions (rule_set_id, version_number, change_summary, thresholds)
    VALUES (
      v_rule_id, 1,
      'Initial seed (ORCH-0526 M2) from ai-verify-pipeline/index.ts:125-134 (ORCH-0460 v2)',
      '{"check_field": "types_array"}'::jsonb
    )
    RETURNING id INTO v_version_id;

    INSERT INTO public.rule_entries (rule_set_version_id, value, position, reason)
    SELECT v_version_id, val, ord, 'Seeded from code constant'
    FROM unnest(ARRAY[
      'garden_center','farm','cemetery','funeral_home'
    ]::text[]) WITH ORDINALITY AS t(val, ord);
  END IF;
END $$;


-- ── Rule 7: DELIVERY_ONLY_PATTERNS (strip, category:flowers) ────────────────

DO $$
DECLARE v_rule_id UUID; v_version_id UUID;
BEGIN
  INSERT INTO public.rule_sets (name, description, kind, scope_kind, scope_value)
  VALUES (
    'DELIVERY_ONLY_PATTERNS',
    'Strip flowers if name matches delivery-only patterns AND primary_type is not florist (no shopfront)',
    'strip', 'category', 'flowers'
  )
  ON CONFLICT (name) DO NOTHING
  RETURNING id INTO v_rule_id;

  IF v_rule_id IS NOT NULL THEN
    INSERT INTO public.rule_set_versions (rule_set_id, version_number, change_summary, thresholds)
    VALUES (
      v_rule_id, 1,
      'Initial seed (ORCH-0526 M2) from ai-verify-pipeline/index.ts:137-141',
      '{"check_field": "name", "exempt_primary": "florist"}'::jsonb
    )
    RETURNING id INTO v_version_id;

    INSERT INTO public.rule_entries (rule_set_version_id, value, position, reason)
    SELECT v_version_id, val, ord, 'Seeded from code constant'
    FROM unnest(ARRAY[
      'flower delivery','floral delivery','same day delivery',
      'same-day delivery','livraison de fleurs','livraison fleurs',
      'blumen lieferung','entrega de flores'
    ]::text[]) WITH ORDINALITY AS t(val, ord);
  END IF;
END $$;


-- ── Rule 8: GARDEN_STORE_PATTERNS (strip, category:flowers) ─────────────────

DO $$
DECLARE v_rule_id UUID; v_version_id UUID;
BEGIN
  INSERT INTO public.rule_sets (name, description, kind, scope_kind, scope_value)
  VALUES (
    'GARDEN_STORE_PATTERNS',
    'Strip flowers if name matches garden-store/landscaping/big-box patterns AND primary_type is not florist (Google often tags garden centers as florists because they sell cut flowers)',
    'strip', 'category', 'flowers'
  )
  ON CONFLICT (name) DO NOTHING
  RETURNING id INTO v_rule_id;

  IF v_rule_id IS NOT NULL THEN
    INSERT INTO public.rule_set_versions (rule_set_id, version_number, change_summary, thresholds)
    VALUES (
      v_rule_id, 1,
      'Initial seed (ORCH-0526 M2) from ai-verify-pipeline/index.ts:146-157 (ORCH-0460)',
      '{"check_field": "name", "exempt_primary": "florist"}'::jsonb
    )
    RETURNING id INTO v_version_id;

    INSERT INTO public.rule_entries (rule_set_version_id, value, position, reason)
    SELECT v_version_id, val, ord, 'Seeded from code constant'
    FROM unnest(ARRAY[
      'garden center','garden centre','garden store',
      'nursery','plant nursery','garden nursery',
      'lawn and garden','lawn & garden',
      'landscaping','landscape supply',
      'home and garden','home & garden',
      'gartencenter','jardinerie',
      'vivero','vivaio','tuincentrum',
      'baumarkt','home depot','lowe''s','lowes',
      'bunnings','b&q','leroy merlin','hornbach',
      'obi ','castorama','gamm vert'
    ]::text[]) WITH ORDINALITY AS t(val, ord);
  END IF;
END $$;


-- ── Rule 9: CREATIVE_ARTS_BLOCKED_TYPES (strip, category:creative_arts) ─────

DO $$
DECLARE v_rule_id UUID; v_version_id UUID;
BEGIN
  INSERT INTO public.rule_sets (name, description, kind, scope_kind, scope_value)
  VALUES (
    'CREATIVE_ARTS_BLOCKED_TYPES',
    'Strip creative_arts if primary_type is food/drink/retail — a restaurant in a historic building is NOT creative_arts',
    'strip', 'category', 'creative_arts'
  )
  ON CONFLICT (name) DO NOTHING
  RETURNING id INTO v_rule_id;

  IF v_rule_id IS NOT NULL THEN
    INSERT INTO public.rule_set_versions (rule_set_id, version_number, change_summary, thresholds)
    VALUES (
      v_rule_id, 1,
      'Initial seed (ORCH-0526 M2) from ai-verify-pipeline/index.ts:166-189 (ORCH-0460)',
      '{"check_field": "primary_type"}'::jsonb
    )
    RETURNING id INTO v_version_id;

    INSERT INTO public.rule_entries (rule_set_version_id, value, position, reason)
    SELECT v_version_id, val, ord, 'Seeded from code constant'
    FROM unnest(ARRAY[
      'restaurant','american_restaurant','asian_restaurant','barbecue_restaurant',
      'brazilian_restaurant','chinese_restaurant','french_restaurant',
      'german_restaurant','greek_restaurant','indian_restaurant',
      'italian_restaurant','japanese_restaurant','korean_restaurant',
      'mexican_restaurant','seafood_restaurant','spanish_restaurant',
      'thai_restaurant','turkish_restaurant','vietnamese_restaurant',
      'fine_dining_restaurant','fast_food_restaurant','brunch_restaurant',
      'breakfast_restaurant','hamburger_restaurant','pizza_restaurant',
      'ramen_restaurant','sushi_restaurant','steak_house','bistro',
      'diner','buffet_restaurant','gastropub',
      'bar','cocktail_bar','wine_bar','lounge_bar','pub','brewery',
      'brewpub','beer_garden','sports_bar','hookah_bar','irish_pub',
      'night_club','winery','bar_and_grill',
      'cafe','coffee_shop','tea_house','bakery','ice_cream_shop',
      'convenience_store','grocery_store','supermarket','store',
      'department_store','shopping_mall',
      'hotel','motel','gas_station','gym','fitness_center'
    ]::text[]) WITH ORDINALITY AS t(val, ord);
  END IF;
END $$;


-- ── Rule 10: MOVIES_THEATRE_BLOCKED_TYPES (strip, category:movies_theatre) ──

DO $$
DECLARE v_rule_id UUID; v_version_id UUID;
BEGIN
  INSERT INTO public.rule_sets (name, description, kind, scope_kind, scope_value)
  VALUES (
    'MOVIES_THEATRE_BLOCKED_TYPES',
    'Strip movies_theatre if primary_type is food/drink/retail — a bar that hosts live music is drinks_and_music, NOT movies_theatre',
    'strip', 'category', 'movies_theatre'
  )
  ON CONFLICT (name) DO NOTHING
  RETURNING id INTO v_rule_id;

  IF v_rule_id IS NOT NULL THEN
    INSERT INTO public.rule_set_versions (rule_set_id, version_number, change_summary, thresholds)
    VALUES (
      v_rule_id, 1,
      'Initial seed (ORCH-0526 M2) from ai-verify-pipeline/index.ts:192-203 (ORCH-0460)',
      '{"check_field": "primary_type"}'::jsonb
    )
    RETURNING id INTO v_version_id;

    INSERT INTO public.rule_entries (rule_set_version_id, value, position, reason)
    SELECT v_version_id, val, ord, 'Seeded from code constant'
    FROM unnest(ARRAY[
      'restaurant','fine_dining_restaurant','fast_food_restaurant',
      'brunch_restaurant','breakfast_restaurant','bistro','diner',
      'cafe','coffee_shop','tea_house','bakery','ice_cream_shop',
      'bar','cocktail_bar','wine_bar','lounge_bar','pub','brewery',
      'brewpub','beer_garden','sports_bar','hookah_bar','irish_pub',
      'night_club','winery','bar_and_grill','gastropub',
      'convenience_store','grocery_store','supermarket','store',
      'department_store','shopping_mall',
      'hotel','motel','gas_station','gym','fitness_center',
      'amusement_center','bowling_alley','video_arcade'
    ]::text[]) WITH ORDINALITY AS t(val, ord);
  END IF;
END $$;


-- ── Rule 11: BRUNCH_CASUAL_BLOCKED_TYPES (strip, category:brunch_lunch_casual) ─

DO $$
DECLARE v_rule_id UUID; v_version_id UUID;
BEGIN
  INSERT INTO public.rule_sets (name, description, kind, scope_kind, scope_value)
  VALUES (
    'BRUNCH_CASUAL_BLOCKED_TYPES',
    'Strip brunch_lunch_casual if types-array contains bar/play/tobacco/sports UNLESS primary_type is in RESTAURANT_TYPES (preserves restaurants-with-bar; strips bars-with-food)',
    'strip', 'category', 'brunch_lunch_casual'
  )
  ON CONFLICT (name) DO NOTHING
  RETURNING id INTO v_rule_id;

  IF v_rule_id IS NOT NULL THEN
    INSERT INTO public.rule_set_versions (rule_set_id, version_number, change_summary, thresholds)
    VALUES (
      v_rule_id, 1,
      'Initial seed (ORCH-0526 M2) from ai-verify-pipeline/index.ts:208-225 (ORCH-0460)',
      '{"check_field": "types_array", "exempt_if_primary_in": "RESTAURANT_TYPES"}'::jsonb
    )
    RETURNING id INTO v_version_id;

    INSERT INTO public.rule_entries (rule_set_version_id, value, position, reason)
    SELECT v_version_id, val, ord, 'Seeded from code constant'
    FROM unnest(ARRAY[
      'bar','cocktail_bar','wine_bar','lounge_bar','pub','brewery',
      'brewpub','beer_garden','sports_bar','hookah_bar','irish_pub',
      'night_club','winery','bar_and_grill',
      'amusement_center','amusement_park','bowling_alley','video_arcade',
      'go_karting_venue','paintball_center','miniature_golf_course',
      'adventure_sports_center','casino','karaoke',
      'community_center','sports_complex','sports_club','athletic_field',
      'stadium','arena','swimming_pool',
      'tobacco_shop',
      'food_court','cafeteria',
      'farm','ranch'
    ]::text[]) WITH ORDINALITY AS t(val, ord);
  END IF;
END $$;


-- ── Rule 12: PLAY_BLOCKED_SECONDARY_TYPES (strip, category:play) ────────────

DO $$
DECLARE v_rule_id UUID; v_version_id UUID;
BEGIN
  INSERT INTO public.rule_sets (name, description, kind, scope_kind, scope_value)
  VALUES (
    'PLAY_BLOCKED_SECONDARY_TYPES',
    'Strip play if types-array contains sports/farm/kids/community-center secondary types',
    'strip', 'category', 'play'
  )
  ON CONFLICT (name) DO NOTHING
  RETURNING id INTO v_rule_id;

  IF v_rule_id IS NOT NULL THEN
    INSERT INTO public.rule_set_versions (rule_set_id, version_number, change_summary, thresholds)
    VALUES (
      v_rule_id, 1,
      'Initial seed (ORCH-0526 M2) from ai-verify-pipeline/index.ts:228-233 (ORCH-0460)',
      '{"check_field": "types_array"}'::jsonb
    )
    RETURNING id INTO v_version_id;

    INSERT INTO public.rule_entries (rule_set_version_id, value, position, reason)
    SELECT v_version_id, val, ord, 'Seeded from code constant'
    FROM unnest(ARRAY[
      'community_center','sports_complex','sports_club',
      'athletic_field','swimming_pool','playground',
      'indoor_playground','childrens_camp','farm','ranch',
      'sports_coaching','sports_school','dog_park'
    ]::text[]) WITH ORDINALITY AS t(val, ord);
  END IF;
END $$;


-- ── Rule 13: RESTAURANT_TYPES (whitelist, global) ───────────────────────────
-- NOT a verdict-producing rule — used as eligibility input by promotion rules R17/R18

DO $$
DECLARE v_rule_id UUID; v_version_id UUID;
BEGIN
  INSERT INTO public.rule_sets (name, description, kind, scope_kind, scope_value)
  VALUES (
    'RESTAURANT_TYPES',
    'Google primary_type values that count as a real restaurant — used by FINE_DINING_PROMOTION_T1/T2 to determine eligibility (not a standalone verdict)',
    'whitelist', 'global', NULL
  )
  ON CONFLICT (name) DO NOTHING
  RETURNING id INTO v_rule_id;

  IF v_rule_id IS NOT NULL THEN
    INSERT INTO public.rule_set_versions (rule_set_id, version_number, change_summary, thresholds)
    VALUES (
      v_rule_id, 1,
      'Initial seed (ORCH-0526 M2) from ai-verify-pipeline/index.ts:239-260 (ORCH-0460 expanded)',
      '{"purpose": "promotion_eligibility"}'::jsonb
    )
    RETURNING id INTO v_version_id;

    INSERT INTO public.rule_entries (rule_set_version_id, value, position, reason)
    SELECT v_version_id, val, ord, 'Seeded from code constant'
    FROM unnest(ARRAY[
      'restaurant','fine_dining_restaurant','american_restaurant',
      'asian_restaurant','asian_fusion_restaurant','barbecue_restaurant',
      'brazilian_restaurant','caribbean_restaurant','chinese_restaurant',
      'ethiopian_restaurant','french_restaurant','fusion_restaurant',
      'german_restaurant','greek_restaurant','indian_restaurant',
      'indonesian_restaurant','italian_restaurant','japanese_restaurant',
      'korean_restaurant','korean_barbecue_restaurant','lebanese_restaurant',
      'mediterranean_restaurant','mexican_restaurant','middle_eastern_restaurant',
      'moroccan_restaurant','north_indian_restaurant','peruvian_restaurant',
      'ramen_restaurant','seafood_restaurant','spanish_restaurant',
      'sushi_restaurant','tapas_restaurant','turkish_restaurant',
      'vegan_restaurant','vegetarian_restaurant','vietnamese_restaurant',
      'steak_house','bistro','british_restaurant','belgian_restaurant',
      'fondue_restaurant','oyster_bar_restaurant',
      'basque_restaurant','persian_restaurant','scandinavian_restaurant',
      'argentinian_restaurant','swiss_restaurant','european_restaurant',
      'australian_restaurant',
      'gastropub','dim_sum_restaurant','filipino_restaurant',
      'soul_food_restaurant','cuban_restaurant','hawaiian_restaurant'
    ]::text[]) WITH ORDINALITY AS t(val, ord);
  END IF;
END $$;


-- ── Rule 14: UPSCALE_CHAIN_PROTECTION (whitelist, global) ───────────────────

DO $$
DECLARE v_rule_id UUID; v_version_id UUID;
BEGIN
  INSERT INTO public.rule_sets (name, description, kind, scope_kind, scope_value)
  VALUES (
    'UPSCALE_CHAIN_PROTECTION',
    'Upscale chain names protected from CASUAL_CHAIN_DEMOTION (Nobu, Morton''s, Ruth''s Chris, etc.) — pass-the-quality-test fine dining chains',
    'whitelist', 'global', NULL
  )
  ON CONFLICT (name) DO NOTHING
  RETURNING id INTO v_rule_id;

  IF v_rule_id IS NOT NULL THEN
    INSERT INTO public.rule_set_versions (rule_set_id, version_number, change_summary, thresholds)
    VALUES (
      v_rule_id, 1,
      'Initial seed (ORCH-0526 M2) from ai-verify-pipeline/index.ts:273-280 (ORCH-0460)',
      '{"purpose": "block_demotion", "guards_rule": "CASUAL_CHAIN_DEMOTION"}'::jsonb
    )
    RETURNING id INTO v_version_id;

    INSERT INTO public.rule_entries (rule_set_version_id, value, position, reason)
    SELECT v_version_id, val, ord, 'Seeded from code constant'
    FROM unnest(ARRAY[
      'nobu','morton''s','nusr-et','salt bae','perry''s steakhouse',
      'capital grille','ruth''s chris','fleming''s','eddie v''s',
      'del frisco''s','mastro''s','stk ','boa steakhouse',
      'peter luger','smith & wollensky','the palm',
      'lawry''s','cut by wolfgang','bazaar','jean-georges',
      'le bernardin','eleven madison','alinea','per se'
    ]::text[]) WITH ORDINALITY AS t(val, ord);
  END IF;
END $$;


-- ── Rule 15: SOCIAL_DOMAINS (keyword_set, global) ──────────────────────────
-- NOT a verdict rule — used by Serper search-result extraction to skip non-owned domains

DO $$
DECLARE v_rule_id UUID; v_version_id UUID;
BEGIN
  INSERT INTO public.rule_sets (name, description, kind, scope_kind, scope_value)
  VALUES (
    'SOCIAL_DOMAINS',
    'Domains to skip when extracting "owned website" from Serper search results (social/aggregator/directory sites that are NOT the venue''s own site)',
    'keyword_set', 'global', NULL
  )
  ON CONFLICT (name) DO NOTHING
  RETURNING id INTO v_rule_id;

  IF v_rule_id IS NOT NULL THEN
    INSERT INTO public.rule_set_versions (rule_set_id, version_number, change_summary, thresholds)
    VALUES (
      v_rule_id, 1,
      'Initial seed (ORCH-0526 M2) from ai-verify-pipeline/index.ts:283',
      '{"purpose": "skip_in_serper_extract"}'::jsonb
    )
    RETURNING id INTO v_version_id;

    INSERT INTO public.rule_entries (rule_set_version_id, value, position, reason)
    SELECT v_version_id, val, ord, 'Seeded from code constant'
    FROM unnest(ARRAY[
      'google.com','maps.google.com','facebook.com','instagram.com','twitter.com','x.com',
      'yelp.com','tripadvisor.com','foursquare.com','youtube.com','tiktok.com',
      'linkedin.com','pinterest.com','fresha.com','treatwell.com','treatwell.co.uk',
      'treatwell.de','groupon.com','booksy.com','planity.com','vagaro.com',
      'classpass.com','mindbody.com','wikipedia.org','wikidata.org',
      'yellowpages.com','yell.com','pagesjaunes.fr','dasoertliche.de'
    ]::text[]) WITH ORDINALITY AS t(val, ord);
  END IF;
END $$;


-- ── Rule 16: MIN_DATA_GUARD (min_data_guard, global, ZERO entries) ──────────

DO $$
DECLARE v_rule_id UUID;
BEGIN
  INSERT INTO public.rule_sets (name, description, kind, scope_kind, scope_value)
  VALUES (
    'MIN_DATA_GUARD',
    'Reject places with no rating + no reviews + no website (insufficient data to evaluate). Inline guard at deterministicFilter step 2.',
    'min_data_guard', 'global', NULL
  )
  ON CONFLICT (name) DO NOTHING
  RETURNING id INTO v_rule_id;

  IF v_rule_id IS NOT NULL THEN
    INSERT INTO public.rule_set_versions (rule_set_id, version_number, change_summary, thresholds)
    VALUES (
      v_rule_id, 1,
      'Initial seed (ORCH-0526 M2) from ai-verify-pipeline/index.ts:566-573',
      '{"require_rating": true, "require_reviews": true, "require_website": true, "rejection_reason": "Rules: no rating, no reviews, no website — insufficient data"}'::jsonb
    );
    -- Zero rule_entries — this rule is purely thresholds-driven
  END IF;
END $$;


-- ── Rule 17: FINE_DINING_PROMOTION_T1 (promotion, category:upscale_fine_dining, ZERO entries) ──

DO $$
DECLARE v_rule_id UUID;
BEGIN
  INSERT INTO public.rule_sets (name, description, kind, scope_kind, scope_value)
  VALUES (
    'FINE_DINING_PROMOTION_T1',
    'Auto-promote to upscale_fine_dining if PRICE_LEVEL_VERY_EXPENSIVE + rating ≥ 4.0 + primary_type in RESTAURANT_TYPES. Tier-1 (very expensive). Pure threshold rule.',
    'promotion', 'category', 'upscale_fine_dining'
  )
  ON CONFLICT (name) DO NOTHING
  RETURNING id INTO v_rule_id;

  IF v_rule_id IS NOT NULL THEN
    INSERT INTO public.rule_set_versions (rule_set_id, version_number, change_summary, thresholds)
    VALUES (
      v_rule_id, 1,
      'Initial seed (ORCH-0526 M2) from ai-verify-pipeline/index.ts:614-631',
      '{"price_levels": ["PRICE_LEVEL_VERY_EXPENSIVE"], "rating_min": 4.0, "requires_in": "RESTAURANT_TYPES", "promotion_reason": "Rules: VERY_EXPENSIVE + high rating restaurant — promoted to upscale_fine_dining"}'::jsonb
    );
  END IF;
END $$;


-- ── Rule 18: FINE_DINING_PROMOTION_T2 (promotion, category:upscale_fine_dining, ZERO entries) ──

DO $$
DECLARE v_rule_id UUID;
BEGIN
  INSERT INTO public.rule_sets (name, description, kind, scope_kind, scope_value)
  VALUES (
    'FINE_DINING_PROMOTION_T2',
    'Auto-promote to upscale_fine_dining if PRICE_LEVEL_EXPENSIVE + rating ≥ 4.0 + primary_type in RESTAURANT_TYPES. Tier-2 (expensive). Pure threshold rule.',
    'promotion', 'category', 'upscale_fine_dining'
  )
  ON CONFLICT (name) DO NOTHING
  RETURNING id INTO v_rule_id;

  IF v_rule_id IS NOT NULL THEN
    INSERT INTO public.rule_set_versions (rule_set_id, version_number, change_summary, thresholds)
    VALUES (
      v_rule_id, 1,
      'Initial seed (ORCH-0526 M2) from ai-verify-pipeline/index.ts:633-650 (ORCH-0460)',
      '{"price_levels": ["PRICE_LEVEL_EXPENSIVE"], "rating_min": 4.0, "requires_in": "RESTAURANT_TYPES", "promotion_reason": "Rules: EXPENSIVE + high rating restaurant — promoted to upscale_fine_dining"}'::jsonb
    );
  END IF;
END $$;


-- ── Section: set rule_sets.current_version_id pointers ──────────────────────

UPDATE public.rule_sets rs
SET current_version_id = (
  SELECT rsv.id FROM public.rule_set_versions rsv
  WHERE rsv.rule_set_id = rs.id AND rsv.version_number = 1
  LIMIT 1
)
WHERE rs.current_version_id IS NULL;


-- ── Section: create the v1 manifest in rules_versions ───────────────────────

INSERT INTO public.rules_versions (manifest_label, snapshot, summary)
SELECT
  'v1-initial-seed',
  jsonb_object_agg(rs.id::text, rs.current_version_id::text),
  'Initial seed of 18 rules from ai-verify-pipeline/index.ts (ORCH-0526 M2). Rules: FAST_FOOD_BLACKLIST, EXCLUSION_KEYWORDS, CASUAL_CHAIN_DEMOTION, BLOCKED_PRIMARY_TYPES, FLOWERS_BLOCKED_PRIMARY_TYPES, FLOWERS_BLOCKED_SECONDARY_TYPES, DELIVERY_ONLY_PATTERNS, GARDEN_STORE_PATTERNS, CREATIVE_ARTS_BLOCKED_TYPES, MOVIES_THEATRE_BLOCKED_TYPES, BRUNCH_CASUAL_BLOCKED_TYPES, PLAY_BLOCKED_SECONDARY_TYPES, RESTAURANT_TYPES, UPSCALE_CHAIN_PROTECTION, SOCIAL_DOMAINS, MIN_DATA_GUARD, FINE_DINING_PROMOTION_T1, FINE_DINING_PROMOTION_T2.'
FROM public.rule_sets rs
WHERE rs.current_version_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.rules_versions WHERE manifest_label = 'v1-initial-seed');


-- ═══════════════════════════════════════════════════════════════════════════════
-- END OF M2 — 18 rules seeded with v1 versions + manifest.
--
-- Verification checklist (run post-deploy):
--   SELECT COUNT(*) FROM rule_sets;                                   -- expect 18
--   SELECT COUNT(*) FROM rule_set_versions;                           -- expect 18 (v1 of each)
--   SELECT COUNT(*) FROM rule_entries;                                -- expect ~547
--   SELECT COUNT(*) FROM rules_versions WHERE manifest_label='v1-initial-seed'; -- expect 1
--   SELECT name, kind, scope_kind, scope_value FROM rule_sets ORDER BY name;
--                                                                     -- expect all 18 named rules
--   SELECT name, (SELECT COUNT(*) FROM rule_entries WHERE rule_set_version_id = rs.current_version_id) AS entry_count
--     FROM rule_sets rs ORDER BY entry_count DESC;
--                                                                     -- EXCLUSION_KEYWORDS should be ~150 (largest)
-- ═══════════════════════════════════════════════════════════════════════════════

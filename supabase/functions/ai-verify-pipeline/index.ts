import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ── Blacklists & Keywords (ported from scripts/verify-places-pipeline.mjs) ──

const FAST_FOOD_BLACKLIST = [
  "mcdonald","burger king","kfc","kentucky fried","wendy's","subway",
  "taco bell","chick-fil-a","five guys","popeyes","panda express",
  "domino's","papa john","pizza hut","little caesar","sonic drive",
  "jack in the box","arby's","carl's jr","hardee","del taco",
  "raising cane","whataburger","in-n-out","wingstop","chipotle",
  "shake shack","checkers","rally's","church's chicken","el pollo loco",
  "golden corral","bojangles","cook out","zaxby",
  "panera bread","jersey mike","jimmy john","firehouse sub",
  "qdoba","potbelly","sweetgreen","tropical smoothie",
  "moe's southwest","cava ",
  "starbucks","dunkin","tim horton","costa coffee","krispy kreme",
  "greggs","pret a manger","quick ","nordsee",
  "baskin-robbins","cold stone creamery","häagen-dazs","insomnia cookies",
  "crumbl","smoothie king","nothing bundt","rita's italian ice",
  "jollibee","pollo tropical","pollo campero","telepizza",
];

const EXCLUSION_KEYWORDS: Record<string, string[]> = {
  medical: ["hospital","clinic","dentist","doctor","pharmacy","chiropractor","physiotherapy","veterinary","optometrist","urgent care"],
  government: ["dmv","courthouse","post office","police station","embassy","city hall","fire station"],
  education: ["school","daycare","preschool","tutoring","university campus"],
  grooming: ["threading","waxing studio","lash extension","microblading","permanent makeup","nail salon","hair salon","barber","kosmetikstudio","institut de beauté","beauty parlour","tanning studio","brow bar","beauty salon","beauty lounge","beauty world","beauty bar","med spa","medspa","aesthetics spa","aesthetic clinic","beauty studio"],
  fitness: ["gym","fitness center","crossfit","yoga studio","pilates","martial arts dojo","boxing gym"],
  // ORCH-0460: kids list expanded from 12 to 37 patterns. Catches "Adventure Play Centre",
  // "Toddler Bounce World", "Jungle Gym", "Fun Zone" etc. that were slipping through.
  kids: [
    "kids play","children's","indoor playground","kidz","chuck e. cheese","kidzone",
    "enfants","kinder","bambini","infantil","splash pad","soft play",
    "toddler","baby","babies","bounce house","bouncy castle",
    "bounce ","bouncy","trampoline park","ball pit",
    "play center","play centre","playland","play land",
    "play zone","play world","play park","funland",
    "jungle gym","adventure playground","play space","playspace",
    "little ones","mommy and me","mommy & me","fun zone","funzone",
    "discovery zone","little explorers","tiny town","sensory play",
    "kids kingdom","imagination station",
  ],
  utilitarian: ["gas station","car wash","laundromat","storage unit","parking garage","auto repair","car dealership"],
  delivery: ["ghost kitchen","delivery only","cloud kitchen","virtual kitchen"],
  food_truck: ["food truck","food cart","mobile kitchen"],
  not_venue: ["real estate","insurance","accounting","law firm","consulting","contractor","plumber","electrician","production company","booking agency","talent agency","event management"],
  gambling: ["spielhalle","betting shop","slot machine","gambling hall"],
  allotment: ["kleingartenanlage","kleingarten","kolonie","schrebergarten","allotment garden","jardin partagé","community garden","volkstuinen"],
  // ORCH-0460: Sports parks / recreation centers (Bethesda Park type).
  // These match venue names that reveal athletic/recreation purpose regardless of Google type.
  sports_recreation: [
    "sports park","recreation center","rec center","recreation centre",
    "athletic center","athletic complex","sports complex",
    "community pool","public pool","sports field","ball field",
    "baseball field","softball field","soccer field","football field",
    "tennis center","swim center","aquatic center","fitness park",
    "sportplatz","polideportivo","centro deportivo","complexe sportif",
    "leisure centre","leisure center","recreation ground","sports ground",
    "playing field",
  ],
  // ORCH-0460: Community / civic venues (not date spots).
  community_civic: [
    "community center","community centre","civic center","civic centre",
    "recreation department","parks and recreation","parks & recreation",
    "senior center","senior centre","youth center","youth centre",
    "community hall","town hall","village hall","gemeindezentrum",
    "maison de quartier","centro comunitario","centre communautaire",
    "neighborhood center","neighbourhood centre",
  ],
  // ORCH-0460: Tobacco / hookah lounges (not date spots even with food service).
  tobacco_hookah: [
    "tobacco","cigar lounge","cigar bar","hookah lounge",
    "shisha","shisha lounge","hookah cafe","nargile",
    "chicha","tabak","tabac",
  ],
};

const CASUAL_CHAIN_DEMOTION = [
  "olive garden","red lobster","outback","cheesecake factory","applebee","chili's","tgi friday","denny's","ihop","waffle house","cracker barrel","texas roadhouse","red robin","buffalo wild wings","longhorn steakhouse","nando's","wagamama","yo! sushi","pizza express","pizzaexpress","hippopotamus",
];

// ── Blocked Primary Types (never a date spot) ───────────────────────────────
const BLOCKED_PRIMARY_TYPES = new Set([
  "cemetery", "funeral_home", "gas_station", "car_dealer", "car_wash",
  "car_rental", "auto_repair", "parking", "storage", "laundry",
  "locksmith", "plumber", "electrician", "roofing_contractor",
  "insurance_agency", "real_estate_agency", "accounting",
  "post_office", "fire_station", "police", "courthouse",
  "wedding_venue", "banquet_hall",
]);

// ── Flowers: primary_types that must NEVER get the flowers category ─────────
// ORCH-0460 rework v2 (2026-04-17): Split into PRIMARY vs SECONDARY sets.
// Root cause of P0 in v1: `food_store` is a Google generic secondary type on every
// supermarket (Whole Foods, Trader Joe's, Carrefour, Waitrose, Safeway, Publix).
// When v1 expanded the FLOWERS_BLOCKED_TYPES check to the full `types` array, it
// stripped flowers from 168 legitimate supermarkets — the exact ones the GPT prompt
// names as canonical "keep flowers" examples. Only 1 actual garden store was caught.
//
// Fix: keep the broad list for `primary_type` checks (unchanged behavior for places
// where the food/garden identity IS primary), but use a TIGHT list for types-array
// matching that excludes generic parent types appearing on every supermarket.
const FLOWERS_BLOCKED_PRIMARY_TYPES = new Set([
  "garden_center", "garden", "farm", "supplier", "cemetery", "funeral_home",
  "restaurant", "meal_takeaway", "bar", "food_store",
]);

// For types-array check only. Every entry here MUST be a type that NEVER appears
// on a legitimate supermarket-with-florals. The excluded entries below (commented)
// are kept out deliberately — adding any of them re-introduces the P0.
const FLOWERS_BLOCKED_SECONDARY_TYPES = new Set([
  "garden_center", "farm", "cemetery", "funeral_home",
  // Deliberately NOT included (would false-positive on legit supermarkets):
  //   "food_store"    — on every supermarket (168 false positives caught by QA in v1)
  //   "garden"        — too generic (matches botanical_garden, rose_garden etc.)
  //   "supplier"      — too generic
  //   "restaurant"    — some supermarket/florist hybrids have it
  //   "meal_takeaway" — same as above
  //   "bar"           — ambiguous; wine bars with florals exist internationally
]);

// ── Delivery-only patterns (strip flowers if matched + not a florist) ───────
const DELIVERY_ONLY_PATTERNS = [
  "flower delivery", "floral delivery", "same day delivery",
  "same-day delivery", "livraison de fleurs", "livraison fleurs",
  "blumen lieferung", "entrega de flores",
];

// ── ORCH-0460: Garden store name patterns (strip flowers from non-florist garden stores) ──
// Garden centers often get primary_type='florist' from Google because they sell cut
// flowers as a side business. Real florists don't have these name patterns.
const GARDEN_STORE_PATTERNS = [
  "garden center", "garden centre", "garden store",
  "nursery", "plant nursery", "garden nursery",
  "lawn and garden", "lawn & garden",
  "landscaping", "landscape supply",
  "home and garden", "home & garden",
  "gartencenter", "jardinerie",
  "vivero", "vivaio", "tuincentrum",
  "baumarkt", "home depot", "lowe's", "lowes",
  "bunnings", "b&q", "leroy merlin", "hornbach",
  "obi ", "castorama", "gamm vert",
];

// ── ORCH-0460: Category-specific types-array checks ─────────────────────────
// These sets power the "check the full types array, not just primary_type" fix.
// Root cause of all category leaks: Google returns primary_type=X but the `types`
// array also contains Y (e.g. restaurant + cultural_landmark). The old logic only
// checked primary_type, missing the secondary identity. These sets detect that drift.

// Creative Arts: a restaurant/bar/cafe/store is NEVER arts, even in a historic building.
const CREATIVE_ARTS_BLOCKED_TYPES = new Set([
  // Restaurants (any cuisine)
  "restaurant", "american_restaurant", "asian_restaurant", "barbecue_restaurant",
  "brazilian_restaurant", "chinese_restaurant", "french_restaurant",
  "german_restaurant", "greek_restaurant", "indian_restaurant",
  "italian_restaurant", "japanese_restaurant", "korean_restaurant",
  "mexican_restaurant", "seafood_restaurant", "spanish_restaurant",
  "thai_restaurant", "turkish_restaurant", "vietnamese_restaurant",
  "fine_dining_restaurant", "fast_food_restaurant", "brunch_restaurant",
  "breakfast_restaurant", "hamburger_restaurant", "pizza_restaurant",
  "ramen_restaurant", "sushi_restaurant", "steak_house", "bistro",
  "diner", "buffet_restaurant", "gastropub",
  // Bars / drink
  "bar", "cocktail_bar", "wine_bar", "lounge_bar", "pub", "brewery",
  "brewpub", "beer_garden", "sports_bar", "hookah_bar", "irish_pub",
  "night_club", "winery", "bar_and_grill",
  // Cafes
  "cafe", "coffee_shop", "tea_house", "bakery", "ice_cream_shop",
  // Retail
  "convenience_store", "grocery_store", "supermarket", "store",
  "department_store", "shopping_mall",
  // Other non-arts
  "hotel", "motel", "gas_station", "gym", "fitness_center",
]);

// Movies & Theatre: a bar with live music is NOT movies_theatre, it's drinks_and_music.
const MOVIES_THEATRE_BLOCKED_TYPES = new Set([
  "restaurant", "fine_dining_restaurant", "fast_food_restaurant",
  "brunch_restaurant", "breakfast_restaurant", "bistro", "diner",
  "cafe", "coffee_shop", "tea_house", "bakery", "ice_cream_shop",
  "bar", "cocktail_bar", "wine_bar", "lounge_bar", "pub", "brewery",
  "brewpub", "beer_garden", "sports_bar", "hookah_bar", "irish_pub",
  "night_club", "winery", "bar_and_grill", "gastropub",
  "convenience_store", "grocery_store", "supermarket", "store",
  "department_store", "shopping_mall",
  "hotel", "motel", "gas_station", "gym", "fitness_center",
  "amusement_center", "bowling_alley", "video_arcade",
]);

// Brunch, Lunch & Casual: if types array reveals bar/play/tobacco/sports/farm,
// strip unless primary_type is a REAL restaurant type. Keeps restaurants with
// bar inside, strips bars-with-food.
const BRUNCH_CASUAL_BLOCKED_TYPES = new Set([
  // Bars
  "bar", "cocktail_bar", "wine_bar", "lounge_bar", "pub", "brewery",
  "brewpub", "beer_garden", "sports_bar", "hookah_bar", "irish_pub",
  "night_club", "winery", "bar_and_grill",
  // Play/entertainment
  "amusement_center", "amusement_park", "bowling_alley", "video_arcade",
  "go_karting_venue", "paintball_center", "miniature_golf_course",
  "adventure_sports_center", "casino", "karaoke",
  // Sports/civic
  "community_center", "sports_complex", "sports_club", "athletic_field",
  "stadium", "arena", "swimming_pool",
  // Tobacco/non-restaurant food
  "tobacco_shop",
  "food_court", "cafeteria",
  // Farms
  "farm", "ranch",
]);

// Play: sports parks (Bethesda), farms (Phillips), kids' centers, community centers.
const PLAY_BLOCKED_SECONDARY_TYPES = new Set([
  "community_center", "sports_complex", "sports_club",
  "athletic_field", "swimming_pool", "playground",
  "indoor_playground", "childrens_camp", "farm", "ranch",
  "sports_coaching", "sports_school", "dog_park",
]);

// ── Restaurant primary_types (for fine_dining promotion) ────────────────────
// ORCH-0460: Expanded with 15 world cuisine types + gastropub/bistro so they can
// qualify for auto-promotion to upscale_fine_dining when EXPENSIVE+4.0 or
// VERY_EXPENSIVE+4.0 thresholds are met.
const RESTAURANT_TYPES = new Set([
  "restaurant", "fine_dining_restaurant", "american_restaurant",
  "asian_restaurant", "asian_fusion_restaurant", "barbecue_restaurant",
  "brazilian_restaurant", "caribbean_restaurant", "chinese_restaurant",
  "ethiopian_restaurant", "french_restaurant", "fusion_restaurant",
  "german_restaurant", "greek_restaurant", "indian_restaurant",
  "indonesian_restaurant", "italian_restaurant", "japanese_restaurant",
  "korean_restaurant", "korean_barbecue_restaurant", "lebanese_restaurant",
  "mediterranean_restaurant", "mexican_restaurant", "middle_eastern_restaurant",
  "moroccan_restaurant", "north_indian_restaurant", "peruvian_restaurant",
  "ramen_restaurant", "seafood_restaurant", "spanish_restaurant",
  "sushi_restaurant", "tapas_restaurant", "turkish_restaurant",
  "vegan_restaurant", "vegetarian_restaurant", "vietnamese_restaurant",
  "steak_house", "bistro", "british_restaurant", "belgian_restaurant",
  "fondue_restaurant", "oyster_bar_restaurant",
  // ORCH-0460: new cuisine types for auto-promotion eligibility
  "basque_restaurant", "persian_restaurant", "scandinavian_restaurant",
  "argentinian_restaurant", "swiss_restaurant", "european_restaurant",
  "australian_restaurant", "tapas_restaurant",
  "gastropub", "dim_sum_restaurant", "filipino_restaurant",
  "soul_food_restaurant", "cuban_restaurant", "hawaiian_restaurant",
]);

// ── ORCH-0460: Mutual exclusivity REMOVED ───────────────────────────────────
// A restaurant that qualifies for both upscale_fine_dining AND brunch_lunch_casual
// now gets BOTH categories. Example: Nobu (upscale dinner + casual lunch service).
// Previous enforceExclusivity() function deleted. Its 3 call sites were modified
// to pass categories through directly.

// ── ORCH-0460: Upscale Chain Protection ─────────────────────────────────────
// These chains are documented in category-mapping.md as pass-the-quality-test
// fine dining chains. This whitelist prevents the casual chain demotion logic
// from accidentally stripping upscale_fine_dining if someone adds one of these
// to CASUAL_CHAIN_DEMOTION by mistake.
const UPSCALE_CHAIN_PROTECTION = [
  "nobu", "morton's", "nusr-et", "salt bae", "perry's steakhouse",
  "capital grille", "ruth's chris", "fleming's", "eddie v's",
  "del frisco's", "mastro's", "stk ", "boa steakhouse",
  "peter luger", "smith & wollensky", "the palm",
  "lawry's", "cut by wolfgang", "bazaar", "jean-georges",
  "le bernardin", "eleven madison", "alinea", "per se",
];

const SOCIAL_DOMAINS = [
  "google.com","maps.google.com","facebook.com","instagram.com","twitter.com","x.com","yelp.com","tripadvisor.com","foursquare.com","youtube.com","tiktok.com","linkedin.com","pinterest.com","fresha.com","treatwell.com","treatwell.co.uk","treatwell.de","groupon.com","booksy.com","planity.com","vagaro.com","classpass.com","mindbody.com","wikipedia.org","wikidata.org","yellowpages.com","yell.com","pagesjaunes.fr","dasoertliche.de",
];

// ORCH-0434: GPT prompt rewritten with new 10-category system.
// ORCH-0460: 5 category definitions updated (brunch/casual tightened to real restaurants only,
// upscale loosened to allow high-end tapas/bistros/wine bars, creative_arts excludes food/drink,
// movies_theatre requires DEDICATED venue not bars-with-music, play excludes sports/farms/community).
// Mutual exclusivity between upscale_fine_dining and brunch_lunch_casual REMOVED — a restaurant
// can qualify for both if it serves both casual lunch and upscale dinner (e.g. Nobu, Spago).
const SYSTEM_PROMPT = `You classify places for Mingla, a dating app, into 10 categories.

CATEGORIES (* = must have candidate_website to qualify):
flowers, *upscale_fine_dining, nature, icebreakers, drinks_and_music, brunch_lunch_casual, *movies_theatre, *creative_arts, *play, groceries

CORE RULES:
- Determine what this place PRIMARILY IS first (restaurant, museum, bar, park, etc.)
- Only assign categories where the match is OBVIOUS. Default is zero categories.
- A museum with a cafe is creative_arts, NOT brunch_lunch_casual.
- A park with a kiosk is nature, NOT drinks_and_music.
- If a place fits a category, ASSIGN it. Do not reject places that clearly match a category definition.
- A place CAN qualify for multiple categories if it genuinely fits each — assign all that apply.

CATEGORY DEFINITIONS:

UPSCALE_FINE_DINING: A restaurant, tapas bar, bistro, or wine bar that feels lavish, bougie, special-occasion. The combination of: upscale ambience, high-end cuisine, reservation culture, and elevated service. The question is not "what type of venue is this?" but "does this feel lavish, bougie, special-occasion?" High-end tapas bars, acclaimed bistros, and upscale wine bars with substantial food menus CAN qualify if they pass the special-occasion test. Signals: very high ratings (4.5+) with upscale reviews, $$$/$$$$ pricing, words like "upscale", "elegant", "tasting menu", "sommelier", "Michelin", "acclaimed", "refined". Examples that ARE upscale_fine_dining: Zuma, Manhatta, Nobu, Le Bernardin, Alinea, Tickets (Barcelona tapas), Bazaar by José Andrés, Bistro Paul Bert, any Michelin-starred restaurant, any restaurant described as upscale/elegant/refined with high ratings. Examples that are NOT upscale_fine_dining: casual neighborhood bistros with $15 mains, standard-price brasseries, basic gastropubs, pure cocktail bars with no food menu, charming but casual restaurants. The venue MUST serve food — a pure cocktail bar with no food menu is drinks_and_music regardless of how upscale it is. PRICE_LEVEL_VERY_EXPENSIVE is a very strong signal. Unless clearly casual, a VERY_EXPENSIVE restaurant with 4.0+ rating should get upscale_fine_dining. When genuinely uncertain AND price is MODERATE or INEXPENSIVE or unknown, default to brunch_lunch_casual. A restaurant can qualify for BOTH upscale_fine_dining AND brunch_lunch_casual if it serves both a special-occasion experience AND a casual lunch/brunch menu. Example: Nobu serves fine dining dinner and casual lunch — assign both categories. If both apply, use both.

BRUNCH_LUNCH_CASUAL: A REAL sit-down restaurant with tables, waiters, and a menu. The kind of place you'd say "let's grab dinner" or "let's do brunch." Includes chain restaurants with table service (Olive Garden, IHOP, Outback, Denny's, Chili's, TGI Fridays). Includes ALL cuisines (Persian, Filipino, Cuban, dim sum, soul food, etc.). NO fast food/counter-service/grab-and-go chains (McDonald's, Subway, Starbucks). NO food trucks. NO food courts. NO market stalls or food halls (those are markets, not restaurants). NO delis/counter-service spots. NO cafeterias. NO campus dining halls. A bar or pub that serves food is drinks_and_music, NOT brunch_lunch_casual — the test is whether the PRIMARY identity is a restaurant. A hookah lounge or cigar bar with appetizers is NOT brunch_lunch_casual (that's tobacco/drinks, reject or drinks_and_music). A bowling alley with a restaurant inside is play, NOT brunch_lunch_casual. A wine bar with tapas is drinks_and_music, NOT brunch_lunch_casual. A tobacco shop with a kitchen is NOT brunch_lunch_casual. Only assign brunch_lunch_casual if you would describe the place as "a restaurant" first and foremost.

DRINKS_AND_MUSIC: Bars, cocktail bars, wine bars, breweries, beer gardens, pubs, speakeasies, rooftop bars, nightclubs, live music venues, karaoke bars, hookah bars, wineries. If the primary draw is drinks, music, or social nightlife atmosphere, it's drinks_and_music.

ICEBREAKERS: Cafes, coffee shops, tea houses, bakeries with seating, bookstore cafes, ice cream parlors, juice bars, donut shops and pastry shops with seating. Any casual low-pressure spot for a 45-minute conversation. Perfect for first dates or getting to know someone.

MOVIES_THEATRE: Real cinemas with screens and scheduled movies — movie theaters, indie cinemas, drive-ins, IMAX, AMC, Regal, Cinemark, Alamo Drafthouse. Also includes DEDICATED performing arts venues: concert halls, theaters, opera houses, comedy clubs, jazz clubs, amphitheaters. The venue must be PRIMARILY a cinema or performance space. Stage + scheduled performers + audience = movies_theatre. A bar that hosts live music on weekends is drinks_and_music, NOT movies_theatre. A pub with a comedy night is drinks_and_music, NOT movies_theatre. A cafe near a theater is icebreakers, NOT movies_theatre. Only assign movies_theatre if the place IS a cinema, theater, or concert hall — not if it merely hosts occasional entertainment. NO film production companies, NO booking agencies, NO dance studios.

PLAY: Active fun for adults — bowling, arcades, escape rooms (indoor AND outdoor), go-karts, laser tag, karaoke, mini golf, axe throwing, TopGolf/golf simulators, golf courses, trampoline parks (adult-friendly), VR experiences, rock climbing, kayaking, skydiving, scavenger hunts, outdoor adventure games, amusement parks. NO kids-only venues. NO gyms. NO gambling halls (exception: upscale casinos like Bellagio). NO sports parks or recreation centers (athletic fields, community pools, tennis courts, rec centers — these are fitness/recreation infrastructure, not adult date venues). NO farms or seasonal agricultural attractions (pumpkin patches, corn mazes, berry picking — seasonal and unpredictable). NO community centers or civic facilities.

CREATIVE_ARTS: Museums (all types), art galleries, cultural centers with exhibits, sculpture parks, immersive art (teamLab, Meow Wolf), pottery/paint-and-sip studios open to public, planetariums, aquariums, visitable castles/landmarks. Aquarium → creative_arts + play. A restaurant, bar, cafe, wine bar, or store is NEVER creative_arts — even if it's in a historic building, near a landmark, or has art on the walls. The place must BE an arts/culture venue, not just be located near one.

NATURE: Parks, trails, beaches, botanical gardens, scenic viewpoints, observation decks, waterfronts, bridges, harbors, nature preserves, picnic grounds, hiking areas, vineyards. Any outdoor natural space.

GROCERIES: Grocery stores, supermarkets, specialty food stores, gourmet markets, butcher shops, cheese shops. Places where you buy food to take home or for a picnic.

FLOWERS: Florists, flower shops, flower bars. Large supermarkets with staffed floral departments (like Whole Foods, Wegmans, Publix) qualify for BOTH flowers and groceries. Garden centers, nurseries, and landscaping stores are NOT flowers (they sell potted plants, soil, tools — not date-worthy bouquets).

REJECT if AND ONLY IF the place fits NO category at all: kids-only venue, fast food chain, permanently closed, not a venue (offices/consultants/contractors), personal grooming (salons/barbers/waxing/beauty/aesthetics/lash/brow/nail/hair/med spa), fitness (gyms/yoga), wellness spas, gambling halls, production companies, booking agencies, community centers, recreation centers, farms/ranches with seasonal attractions only, tobacco/hookah lounges, sports parks, campus dining halls.

NEVER reject a place for having a low rating. A bar with 3.2 stars is still a bar. A restaurant with 2.8 stars is still a restaurant. Ratings measure quality, not category fitness. If it fits a category, ACCEPT it regardless of rating.

RECLASSIFY (d:"reclassify"): If a place is in the WRONG category but fits a DIFFERENT valid category, use d:"reclassify" and provide the correct categories in c:[]. Always check if the place fits ANY category before fully rejecting.

*categories need candidate_website to be non-null. If candidate_website is null for a *category, do not assign that category.

If has_opening_hours is false AND the place is NOT a park/trail/beach/outdoor venue, set confidence to "medium" or lower.

WORKED EXAMPLES (learn the pattern):

Example 1: "Whole Foods Market" type:grocery_store → {"d":"accept","c":["groceries","flowers"],"pi":"grocery store","w":false,"r":"Grocery store with staffed floral department","f":"high"}

Example 2: "TopGolf" type:restaurant → {"d":"accept","c":["play","brunch_lunch_casual"],"pi":"golf entertainment venue","w":true,"r":"Interactive golf simulator with restaurant — play + brunch_lunch_casual","f":"high"}

Example 3: "AMC Southpoint 17" type:movie_theater → {"d":"accept","c":["movies_theatre"],"pi":"movie theater","w":true,"r":"Real cinema chain with multiple screens","f":"high"}

Example 4: "Barcelona Wine Bar" type:wine_bar → {"d":"accept","c":["drinks_and_music"],"pi":"tapas wine bar","w":true,"r":"Wine bar with tapas — drinks_and_music. Bar is primary identity, not restaurant.","f":"high"}

Example 5: "Morgan Street Food Hall" type:food_court → {"d":"reject","c":[],"pi":"food hall","w":true,"r":"Food hall with vendors — not a real sit-down restaurant. brunch_lunch_casual requires tables, waiters, menu.","f":"high"}

Example 6: "KidZania" type:amusement_center → {"d":"reject","c":[],"pi":"children's entertainment center","w":true,"r":"Kids-only venue — reject","f":"high"}

Example 7: "Legends Nightclub" type:night_club → {"d":"accept","c":["drinks_and_music"],"pi":"nightclub","w":true,"r":"Nightclub — primary draw is drinks and social atmosphere","f":"high"}

Example 8: "Paris Baguette" type:bakery → {"d":"accept","c":["icebreakers"],"pi":"bakery cafe","w":true,"r":"Bakery with seating — good icebreakers spot","f":"high"}

Example 9: "Living Kiln Studio" type:art_studio → {"d":"accept","c":["creative_arts"],"pi":"pottery studio","w":true,"r":"Pottery studio open to public — creative_arts","f":"high"}

Example 10: "Planet Fitness" type:gym → {"d":"reject","c":[],"pi":"gym","w":true,"r":"Fitness center — reject","f":"high"}

Example 11: "Beauty Blinks Aesthetics/Spa" type:spa → {"d":"reject","c":[],"pi":"beauty salon","w":true,"r":"Beauty/aesthetics in name = personal grooming — reject","f":"high"}

Example 12: "Urban Air Trampoline Park" type:amusement_center → {"d":"reject","c":[],"pi":"children's trampoline park","w":true,"r":"Primarily kids birthday parties — reject","f":"high"}

Example 13: "Painting with a Twist" type:art_studio → {"d":"accept","c":["creative_arts"],"pi":"paint-and-sip studio","w":true,"r":"Public paint-and-sip studio — creative_arts","f":"high"}

Example 14: "The Ruxton Steakhouse" type:steak_house price:PRICE_LEVEL_VERY_EXPENSIVE rating:4.4 → {"d":"accept","c":["upscale_fine_dining"],"pi":"upscale steakhouse","w":true,"r":"VERY_EXPENSIVE steakhouse with high rating — upscale_fine_dining","f":"high"}

Example 15: "Fogo de Chão Brazilian Steakhouse" type:brazilian_restaurant price:PRICE_LEVEL_EXPENSIVE rating:4.8 → {"d":"accept","c":["upscale_fine_dining","brunch_lunch_casual"],"pi":"upscale Brazilian steakhouse chain","w":true,"r":"EXPENSIVE chain with exceptional rating and table service — qualifies for both upscale_fine_dining (special occasion) and brunch_lunch_casual (real sit-down restaurant)","f":"high"}

Example 16: "Jazz at Lincoln Center" type:performing_arts_theater → {"d":"accept","c":["movies_theatre"],"pi":"jazz concert venue","w":true,"r":"Live performance venue with scheduled shows — movies_theatre","f":"high"}

Example 17: "Riverside Community Center" type:amusement_center → {"d":"reject","c":[],"pi":"community center","w":false,"r":"Community center — civic facility, not a date venue","f":"high"}

Example 18: "Phillips Farms" type:amusement_park → {"d":"reject","c":[],"pi":"seasonal farm attraction","w":true,"r":"Farm with seasonal activities (pumpkin patch, corn maze) — seasonal/unpredictable, reject","f":"high"}

Example 19: "Bethesda Park Recreation Center" type:amusement_center → {"d":"reject","c":[],"pi":"sports recreation center","w":true,"r":"Recreation center with athletic fields/pool — not an adult play venue","f":"high"}

Example 20: "Adventure Play Centre" type:amusement_center → {"d":"reject","c":[],"pi":"children's play center","w":true,"r":"Indoor play center for children — not adult date venue","f":"high"}

Example 21: "The Wine Gallery" type:wine_bar → {"d":"accept","c":["drinks_and_music"],"pi":"wine bar","w":true,"r":"Wine bar — drinks_and_music. 'Gallery' in name does NOT make it creative_arts.","f":"high"}

Example 22: "Stadium Bar & Grill" type:bar → {"d":"accept","c":["drinks_and_music"],"pi":"sports bar","w":true,"r":"Bar primary identity despite food service — drinks_and_music, not brunch_lunch_casual","f":"high"}

Example 23: "Nobu Downtown" type:japanese_restaurant price:PRICE_LEVEL_VERY_EXPENSIVE rating:4.6 → {"d":"accept","c":["upscale_fine_dining","brunch_lunch_casual"],"pi":"upscale Japanese restaurant","w":true,"r":"Special-occasion dinner AND casual lunch service — qualifies for both categories","f":"high"}

Example 24: "Le Bernardin" type:seafood_restaurant price:PRICE_LEVEL_VERY_EXPENSIVE rating:4.7 (dinner-only) → {"d":"accept","c":["upscale_fine_dining"],"pi":"Michelin-starred seafood restaurant","w":true,"r":"Michelin-starred, dinner only — upscale_fine_dining only","f":"high"}

Return ONLY valid JSON.`;

const CLASSIFICATION_SCHEMA = {
  type: "object",
  properties: {
    d: { type: "string", enum: ["accept", "reject", "reclassify"] },
    c: { type: "array", items: { type: "string" } },
    pi: { type: "string" },
    w: { type: "boolean" },
    r: { type: "string" },
    f: { type: "string", enum: ["high", "medium", "low"] },
  },
  required: ["d", "c", "pi", "w", "r", "f"],
  additionalProperties: false,
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function nameMatches(name: string, list: string[]): boolean {
  const lower = name.toLowerCase();
  return list.some((term) => lower.includes(term.toLowerCase()));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

interface SerperResult {
  title: string;
  snippet: string;
  domain: string;
  link: string;
}

async function searchPlace(name: string, address: string): Promise<SerperResult[]> {
  const apiKey = Deno.env.get("SERPER_API_KEY") ?? "";
  const res = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ q: `"${name}" "${address}"`, num: 5 }),
  });
  if (!res.ok) throw new Error(`Serper ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return (data.organic || []).slice(0, 5).map((r: any) => {
    let domain = "";
    try { domain = new URL(r.link).hostname; } catch { domain = r.link; }
    return { title: r.title, snippet: (r.snippet || "").slice(0, 160), domain, link: r.link };
  });
}

function extractOwnedDomain(results: SerperResult[]): { domain: string; url: string } | null {
  for (const r of results) {
    if (!SOCIAL_DOMAINS.some((s) => r.domain.includes(s))) {
      return { domain: r.domain, url: r.link };
    }
  }
  return null;
}

async function verifyWebsite(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      headers: { "User-Agent": "Mingla-Bot/1.0" },
      redirect: "follow",
    });
    return res.ok || res.status < 500;
  } catch {
    return false;
  }
}

interface ClassResult {
  decision: string;
  categories: string[];
  primary_identity: string;
  website_verified: boolean;
  reason: string;
  confidence: string;
  input_tokens: number;
  output_tokens: number;
}

async function withRetry<T>(fn: () => Promise<T>, retries = 1, delayMs = 3000): Promise<T> {
  try { return await fn(); }
  catch (err) {
    const msg = (err as Error).message || "";
    // Permanent quota exceeded — don't waste a retry
    if (msg.includes("QUOTA_EXCEEDED")) throw err;
    // Transient errors (including 429 rate limit) — retry if attempts remain
    if (retries <= 0) throw err;
    await sleep(delayMs);
    return withRetry(fn, retries - 1, delayMs);
  }
}

// IMPORTANT: These token rates are for gpt-4o-mini. Update if model changes.
async function classifyPlace(factSheet: Record<string, unknown>): Promise<ClassResult> {
  return withRetry(async () => {
    const openaiKey = Deno.env.get("OPENAI_API_KEY") ?? "";
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        input: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: JSON.stringify(factSheet) },
        ],
        text: {
          format: { type: "json_schema", name: "place_classification", schema: CLASSIFICATION_SCHEMA, strict: true },
        },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      if (res.status === 429 || errText.includes("quota") || errText.includes("exceeded")) {
        throw new Error(`QUOTA_EXCEEDED: OpenAI quota exceeded (${res.status}). Top up credits and retry.`);
      }
      throw new Error(`OpenAI ${res.status}: ${errText}`);
    }

    const data = await res.json();
    const outputText = data.output?.find((o: any) => o.type === "message")
      ?.content?.find((c: any) => c.type === "output_text")?.text;
    if (!outputText) throw new Error("No text output from GPT response");
    const parsed = JSON.parse(outputText);
    // Filter hallucinated categories — only allow known slugs
    // ORCH-0434: Updated to new canonical slugs (10 categories).
    const VALID_SLUGS = new Set([
      "flowers","upscale_fine_dining","nature","icebreakers","drinks_and_music",
      "brunch_lunch_casual","movies_theatre","creative_arts","play","groceries",
    ]);
    // ORCH-0460: no exclusivity filter — upscale and casual can coexist
    parsed.c = (parsed.c || []).filter((s: string) => VALID_SLUGS.has(s));
    return {
      decision: parsed.d,
      categories: parsed.c,
      primary_identity: parsed.pi,
      website_verified: parsed.w,
      reason: parsed.r,
      confidence: parsed.f,
      input_tokens: data.usage?.input_tokens || 0,
      output_tokens: data.usage?.output_tokens || 0,
    };
  });
}

// ── Deterministic Pre-Filter ─────────────────────────────────────────────────

interface PreFilterResult {
  verdict: "reject" | "accept" | "modify" | "pass";
  reason?: string;
  categories?: string[];
  stageResolved?: number;
}

function deterministicFilter(place: any): PreFilterResult {
  const name = place.name || "";
  const primaryType = place.primary_type || "";
  // FIX: normalize underscores to spaces for keyword matching
  const normalizedType = primaryType.replace(/_/g, " ");
  const checkText = `${name} ${normalizedType}`.toLowerCase();

  // 1. Blocked primary types — instant reject
  if (BLOCKED_PRIMARY_TYPES.has(primaryType)) {
    return {
      verdict: "reject",
      reason: `Rules: blocked primary_type '${primaryType}' — not a date venue`,
      categories: [],
      stageResolved: 2,
    };
  }

  // 2. Minimum-data guard — reject empty-profile places
  const rating = place.rating;
  const reviews = place.review_count || 0;
  const website = place.website;
  if (rating == null && reviews === 0 && !website) {
    return {
      verdict: "reject",
      reason: "Rules: no rating, no reviews, no website — insufficient data",
      categories: [],
      stageResolved: 2,
    };
  }

  // 3. Fast food blacklist
  if (nameMatches(name, FAST_FOOD_BLACKLIST)) {
    return {
      verdict: "reject",
      reason: "Pipeline: fast food chain — rejected",
      categories: [],
      stageResolved: 2,
    };
  }

  // 4. Exclusion keywords (now with normalized underscores)
  for (const [category, keywords] of Object.entries(EXCLUSION_KEYWORDS)) {
    if (keywords.some((kw) => checkText.includes(kw.toLowerCase()))) {
      return {
        verdict: "reject",
        reason: `Pipeline: excluded type (${category}) — rejected`,
        categories: [],
        stageResolved: 2,
      };
    }
  }

  // 5. Casual chain demotion (ORCH-0434: updated slugs)
  // ORCH-0460: Guard — protected upscale chains (Nobu, Morton's, Ruth's Chris etc.)
  // must NEVER be demoted even if their name matches a casual chain pattern.
  if (nameMatches(name, CASUAL_CHAIN_DEMOTION) && !nameMatches(name, UPSCALE_CHAIN_PROTECTION)) {
    const cats = [...(place.ai_categories || [])];
    if (cats.includes("upscale_fine_dining")) {
      const newCats = cats.filter((c: string) => c !== "upscale_fine_dining");
      if (!newCats.includes("brunch_lunch_casual")) newCats.push("brunch_lunch_casual");
      return {
        verdict: "accept",
        reason: "Pipeline: sit-down chain — downgraded from upscale_fine_dining to brunch_lunch_casual",
        categories: newCats,
        stageResolved: 2,
      };
    }
  }

  // 6. Fine dining promotion — tier 1: VERY_EXPENSIVE + 4.0+ rating + restaurant type
  if (
    place.price_level === "PRICE_LEVEL_VERY_EXPENSIVE" &&
    rating != null && rating >= 4.0 &&
    RESTAURANT_TYPES.has(primaryType)
  ) {
    const cats = [...(place.ai_categories || [])];
    if (!cats.includes("upscale_fine_dining")) {
      cats.push("upscale_fine_dining");
      return {
        verdict: "modify",
        reason: "Rules: VERY_EXPENSIVE + high rating restaurant — promoted to upscale_fine_dining",
        // ORCH-0460: no exclusivity enforcement — place can be both upscale and casual
        categories: cats,
        stageResolved: 2,
      };
    }
  }

  // 6b. ORCH-0460: Fine dining promotion — tier 2: EXPENSIVE + 4.0+ rating + restaurant type.
  // Catches acclaimed restaurants at the EXPENSIVE tier that don't hit VERY_EXPENSIVE.
  if (
    place.price_level === "PRICE_LEVEL_EXPENSIVE" &&
    rating != null && rating >= 4.0 &&
    RESTAURANT_TYPES.has(primaryType)
  ) {
    const cats = [...(place.ai_categories || [])];
    if (!cats.includes("upscale_fine_dining")) {
      cats.push("upscale_fine_dining");
      return {
        verdict: "modify",
        reason: "Rules: EXPENSIVE + high rating restaurant — promoted to upscale_fine_dining",
        categories: cats,
        stageResolved: 2,
      };
    }
  }

  // 7. Per-category type blocking
  // ORCH-0460: Core fix — check the FULL `types` array, not just primary_type.
  // Every category leak (garden stores → flowers, restaurants → creative_arts,
  // bars → movies_theatre, bars/play/tobacco → brunch_lunch_casual, sports parks
  // → play) shared one root cause: filters only checked primary_type while the
  // disqualifying type sat in the secondary `types` array.
  const cats = [...(place.ai_categories || [])];
  const typesArray: string[] = place.types || [];
  let modified = false;
  let modifyReason = "";

  // 7a. Creative Arts: strip if primary_type is food/drink/retail.
  // "A restaurant, bar, cafe, or store is NEVER creative_arts, even in a historic building."
  if (cats.includes("creative_arts") && CREATIVE_ARTS_BLOCKED_TYPES.has(primaryType)) {
    const idx = cats.indexOf("creative_arts");
    cats.splice(idx, 1);
    modified = true;
    modifyReason = `Rules: stripped 'creative_arts' — primary_type '${primaryType}' is not an arts venue`;
  }

  // 7b. Movies & Theatre: strip if primary_type is food/drink/retail.
  // "A bar with live music is drinks_and_music, NOT movies_theatre."
  if (cats.includes("movies_theatre") && MOVIES_THEATRE_BLOCKED_TYPES.has(primaryType)) {
    const idx = cats.indexOf("movies_theatre");
    cats.splice(idx, 1);
    modified = true;
    modifyReason = `Rules: stripped 'movies_theatre' — primary_type '${primaryType}' is not a cinema or performance venue`;
  }

  // 7c. Brunch, Lunch & Casual: strip if types array reveals bar/play/tobacco/sports.
  // CRITICAL: preserve if primary_type IS a real restaurant type — a restaurant
  // with a bar inside keeps the category; a bar with food doesn't.
  if (cats.includes("brunch_lunch_casual")) {
    const hasBlockedType = typesArray.some((t: string) => BRUNCH_CASUAL_BLOCKED_TYPES.has(t));
    const isRealRestaurant = RESTAURANT_TYPES.has(primaryType)
      || ["brunch_restaurant", "breakfast_restaurant", "bistro", "diner", "family_restaurant"].includes(primaryType);
    if (hasBlockedType && !isRealRestaurant) {
      const idx = cats.indexOf("brunch_lunch_casual");
      cats.splice(idx, 1);
      modified = true;
      modifyReason = `Rules: stripped 'brunch_lunch_casual' — types array contains non-restaurant type, primary is '${primaryType}'`;
    }
  }

  // 7d. Play: strip if types array reveals sports/farm/kids/community center.
  // Catches Bethesda Park (sports_complex in types), Phillips Farms (farm in types),
  // children's play centers (indoor_playground in types), community centers.
  if (cats.includes("play")) {
    const hasBlockedPlayType = typesArray.some((t: string) => PLAY_BLOCKED_SECONDARY_TYPES.has(t));
    if (hasBlockedPlayType) {
      const idx = cats.indexOf("play");
      cats.splice(idx, 1);
      modified = true;
      modifyReason = `Rules: stripped 'play' — types array contains non-play type`;
    }
  }

  // 7e. Flowers: expanded to check the types array + garden store name patterns.
  // Catches garden centers that Google tags with primary_type='florist' (because
  // they sell cut flowers) but also have 'garden_center' in the types array.
  // ORCH-0460 v2: primary check uses broad PRIMARY set; types-array check uses
  // tight SECONDARY set to avoid false-positive stripping on every supermarket.
  if (cats.includes("flowers")) {
    const hasBlockedFlowerType = FLOWERS_BLOCKED_PRIMARY_TYPES.has(primaryType)
      || typesArray.some((t: string) => FLOWERS_BLOCKED_SECONDARY_TYPES.has(t));
    const isGardenStore = GARDEN_STORE_PATTERNS.some((p) =>
      name.toLowerCase().includes(p)
    );
    if (hasBlockedFlowerType || (isGardenStore && primaryType !== "florist")) {
      const idx = cats.indexOf("flowers");
      if (idx >= 0) {
        cats.splice(idx, 1);
        modified = true;
        modifyReason = hasBlockedFlowerType
          ? `Rules: stripped 'flowers' — blocked type (primary: '${primaryType}')`
          : `Rules: stripped 'flowers' — garden store name pattern detected`;
      }
    }
  }

  // 8. Delivery-only florist detection (conservative: must match pattern AND not be a florist)
  if (
    cats.includes("flowers") &&
    primaryType !== "florist" &&
    DELIVERY_ONLY_PATTERNS.some((p) => name.toLowerCase().includes(p))
  ) {
    const idx = cats.indexOf("flowers");
    if (idx >= 0) {
      cats.splice(idx, 1);
      modified = true;
      modifyReason = `Rules: delivery-only pattern in name, not a florist — stripped 'flowers'`;
    }
  }

  if (modified) {
    // If stripping left zero categories AND place was previously approved, reject it
    if (cats.length === 0) {
      return {
        verdict: "reject",
        reason: modifyReason + " — no remaining categories, rejected",
        categories: [],
        stageResolved: 2,
      };
    }
    return { verdict: "modify", reason: modifyReason, categories: cats, stageResolved: 2 };
  }

  return { verdict: "pass" };
}

// ── DB-Backed Rule Loading (ORCH-0526 M2) ───────────────────────────────────
// Loads the 18 rule_sets from the new tables (per M1) so deterministicFilter
// can run against admin-edited rules instead of the in-code constants above.
//
// TRANSITION GUARD (I-RULES-FALLBACK-SAFE): if rules_versions table is empty,
// returns null and the caller falls back to the in-code constants. This keeps
// the cutover safe and protects against accidental rule deletion.

interface LoadedRuleEntry {
  value: string;
  sub_category: string | null;
}

interface LoadedRule {
  rule_set_id: string;
  rule_set_version_id: string;
  name: string;
  kind: string;
  scope_kind: string;
  scope_value: string | null;
  thresholds: Record<string, unknown> | null;
  entries: LoadedRuleEntry[];
  is_active: boolean;
}

interface LoadedRules {
  rulesVersionId: string;
  manifestLabel: string | null;
  byName: Record<string, LoadedRule>;
}

// deno-lint-ignore no-explicit-any
async function loadRulesFromDb(db: any, rulesVersionId: string | null): Promise<LoadedRules | null> {
  // 1. Resolve manifest: caller-pinned OR latest deployed
  let manifest: { id: string; manifest_label: string | null; snapshot: Record<string, string> } | null = null;
  if (rulesVersionId) {
    const { data } = await db.from("rules_versions")
      .select("id, manifest_label, snapshot")
      .eq("id", rulesVersionId)
      .maybeSingle();
    manifest = data;
  } else {
    const { data } = await db.from("rules_versions")
      .select("id, manifest_label, snapshot")
      .order("deployed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    manifest = data;
  }
  if (!manifest) return null;

  const versionIds = Object.values(manifest.snapshot);
  if (versionIds.length === 0) return null;

  // 2. Load rule_set_versions (with parent rule_sets via inner join)
  const { data: versions, error: vErr } = await db.from("rule_set_versions")
    .select("id, rule_set_id, thresholds, rule_sets!inner(name, kind, scope_kind, scope_value, is_active)")
    .in("id", versionIds);
  if (vErr) {
    console.error("loadRulesFromDb versions error:", vErr.message);
    return null;
  }

  // 3. Load entries
  const { data: entries, error: eErr } = await db.from("rule_entries")
    .select("rule_set_version_id, value, sub_category")
    .in("rule_set_version_id", versionIds);
  if (eErr) {
    console.error("loadRulesFromDb entries error:", eErr.message);
    return null;
  }

  // 4. Group entries by version
  const entriesByVersion: Record<string, LoadedRuleEntry[]> = {};
  for (const e of (entries || [])) {
    if (!entriesByVersion[e.rule_set_version_id]) entriesByVersion[e.rule_set_version_id] = [];
    entriesByVersion[e.rule_set_version_id].push({ value: e.value, sub_category: e.sub_category });
  }

  // 5. Build the byName lookup
  const byName: Record<string, LoadedRule> = {};
  for (const v of (versions || [])) {
    // deno-lint-ignore no-explicit-any
    const rs = (v as any).rule_sets;
    byName[rs.name] = {
      rule_set_id: v.rule_set_id,
      rule_set_version_id: v.id,
      name: rs.name,
      kind: rs.kind,
      scope_kind: rs.scope_kind,
      scope_value: rs.scope_value,
      thresholds: v.thresholds,
      entries: entriesByVersion[v.id] || [],
      is_active: rs.is_active,
    };
  }

  return {
    rulesVersionId: manifest.id,
    manifestLabel: manifest.manifest_label,
    byName,
  };
}

interface PreFilterResultDb extends PreFilterResult {
  ruleSetVersionId?: string | null;
}

// 1:1 translation of deterministicFilter (lines 545-760) but reads from
// DB-loaded rules instead of in-code constants. Tags every verdict with the
// rule_set_version_id of the rule that produced it (V6 gap close: per-place
// rule attribution stored on ai_validation_results).
//
// Same firing order, same short-circuit semantics, same accumulative strip rules.
// ORCH-0526 M2.
//
// deno-lint-ignore no-explicit-any
function deterministicFilterFromDb(place: any, loaded: LoadedRules): PreFilterResultDb {
  const name = place.name || "";
  const primaryType = place.primary_type || "";
  const normalizedType = primaryType.replace(/_/g, " ");
  const checkText = `${name} ${normalizedType}`.toLowerCase();

  const lookupActive = (n: string): LoadedRule | null => {
    const r = loaded.byName[n];
    return r && r.is_active ? r : null;
  };

  // 1. BLOCKED_PRIMARY_TYPES — instant reject
  const r1 = lookupActive("BLOCKED_PRIMARY_TYPES");
  if (r1 && r1.entries.some((e) => e.value === primaryType)) {
    return {
      verdict: "reject",
      reason: `Rules: blocked primary_type '${primaryType}' — not a date venue`,
      categories: [],
      stageResolved: 2,
      ruleSetVersionId: r1.rule_set_version_id,
    };
  }

  // 2. MIN_DATA_GUARD (threshold-based, 0 entries)
  const r2 = lookupActive("MIN_DATA_GUARD");
  if (r2) {
    // deno-lint-ignore no-explicit-any
    const t = (r2.thresholds || {}) as any;
    const requireRating = t.require_rating !== false;
    const requireReviews = t.require_reviews !== false;
    const requireWebsite = t.require_website !== false;
    const noRating = place.rating == null && requireRating;
    const noReviews = (place.review_count || 0) === 0 && requireReviews;
    const noWebsite = !place.website && requireWebsite;
    if (noRating && noReviews && noWebsite) {
      return {
        verdict: "reject",
        reason: "Rules: no rating, no reviews, no website — insufficient data",
        categories: [],
        stageResolved: 2,
        ruleSetVersionId: r2.rule_set_version_id,
      };
    }
  }

  // 3. FAST_FOOD_BLACKLIST
  const r3 = lookupActive("FAST_FOOD_BLACKLIST");
  if (r3 && r3.entries.some((e) => name.toLowerCase().includes(e.value))) {
    return {
      verdict: "reject",
      reason: "Pipeline: fast food chain — rejected",
      categories: [],
      stageResolved: 2,
      ruleSetVersionId: r3.rule_set_version_id,
    };
  }

  // 4. EXCLUSION_KEYWORDS (sub-category aware)
  const r4 = lookupActive("EXCLUSION_KEYWORDS");
  if (r4) {
    const bySub: Record<string, string[]> = {};
    for (const e of r4.entries) {
      const sub = e.sub_category || "unknown";
      if (!bySub[sub]) bySub[sub] = [];
      bySub[sub].push(e.value);
    }
    for (const [subCategory, keywords] of Object.entries(bySub)) {
      if (keywords.some((kw) => checkText.includes(kw.toLowerCase()))) {
        return {
          verdict: "reject",
          reason: `Pipeline: excluded type (${subCategory}) — rejected`,
          categories: [],
          stageResolved: 2,
          ruleSetVersionId: r4.rule_set_version_id,
        };
      }
    }
  }

  // 5. CASUAL_CHAIN_DEMOTION (guarded by UPSCALE_CHAIN_PROTECTION)
  const r5 = lookupActive("CASUAL_CHAIN_DEMOTION");
  const r5Guard = lookupActive("UPSCALE_CHAIN_PROTECTION");
  if (r5) {
    const matchesCasual = r5.entries.some((e) => name.toLowerCase().includes(e.value));
    const isProtected = r5Guard
      ? r5Guard.entries.some((e) => name.toLowerCase().includes(e.value))
      : false;
    if (matchesCasual && !isProtected) {
      const cats = [...(place.ai_categories || [])];
      if (cats.includes("upscale_fine_dining")) {
        const newCats = cats.filter((c: string) => c !== "upscale_fine_dining");
        if (!newCats.includes("brunch_lunch_casual")) newCats.push("brunch_lunch_casual");
        return {
          verdict: "accept",
          reason: "Pipeline: sit-down chain — downgraded from upscale_fine_dining to brunch_lunch_casual",
          categories: newCats,
          stageResolved: 2,
          ruleSetVersionId: r5.rule_set_version_id,
        };
      }
    }
  }

  // 6. FINE_DINING_PROMOTION_T1 (VERY_EXPENSIVE + 4.0+ + RESTAURANT_TYPES)
  const r6Restaurants = lookupActive("RESTAURANT_TYPES");
  const r6 = lookupActive("FINE_DINING_PROMOTION_T1");
  if (r6 && r6Restaurants) {
    // deno-lint-ignore no-explicit-any
    const t = (r6.thresholds || {}) as any;
    const priceLevels: string[] = t.price_levels || ["PRICE_LEVEL_VERY_EXPENSIVE"];
    const ratingMin: number = t.rating_min ?? 4.0;
    if (
      priceLevels.includes(place.price_level) &&
      place.rating != null && place.rating >= ratingMin &&
      r6Restaurants.entries.some((e) => e.value === primaryType)
    ) {
      const cats = [...(place.ai_categories || [])];
      if (!cats.includes("upscale_fine_dining")) {
        cats.push("upscale_fine_dining");
        return {
          verdict: "modify",
          reason: "Rules: VERY_EXPENSIVE + high rating restaurant — promoted to upscale_fine_dining",
          categories: cats,
          stageResolved: 2,
          ruleSetVersionId: r6.rule_set_version_id,
        };
      }
    }
  }

  // 6b. FINE_DINING_PROMOTION_T2 (EXPENSIVE)
  const r7 = lookupActive("FINE_DINING_PROMOTION_T2");
  if (r7 && r6Restaurants) {
    // deno-lint-ignore no-explicit-any
    const t = (r7.thresholds || {}) as any;
    const priceLevels: string[] = t.price_levels || ["PRICE_LEVEL_EXPENSIVE"];
    const ratingMin: number = t.rating_min ?? 4.0;
    if (
      priceLevels.includes(place.price_level) &&
      place.rating != null && place.rating >= ratingMin &&
      r6Restaurants.entries.some((e) => e.value === primaryType)
    ) {
      const cats = [...(place.ai_categories || [])];
      if (!cats.includes("upscale_fine_dining")) {
        cats.push("upscale_fine_dining");
        return {
          verdict: "modify",
          reason: "Rules: EXPENSIVE + high rating restaurant — promoted to upscale_fine_dining",
          categories: cats,
          stageResolved: 2,
          ruleSetVersionId: r7.rule_set_version_id,
        };
      }
    }
  }

  // 7. Per-category strip rules (accumulative, not short-circuit)
  const cats = [...(place.ai_categories || [])];
  const typesArray: string[] = place.types || [];
  let modified = false;
  let modifyReason = "";
  let modifyVersionId: string | null = null;

  // 7a. CREATIVE_ARTS_BLOCKED_TYPES
  const r8 = lookupActive("CREATIVE_ARTS_BLOCKED_TYPES");
  if (r8 && cats.includes("creative_arts")) {
    if (r8.entries.some((e) => e.value === primaryType)) {
      const idx = cats.indexOf("creative_arts");
      cats.splice(idx, 1);
      modified = true;
      modifyReason = `Rules: stripped 'creative_arts' — primary_type '${primaryType}' is not an arts venue`;
      modifyVersionId = r8.rule_set_version_id;
    }
  }

  // 7b. MOVIES_THEATRE_BLOCKED_TYPES
  const r9 = lookupActive("MOVIES_THEATRE_BLOCKED_TYPES");
  if (r9 && cats.includes("movies_theatre")) {
    if (r9.entries.some((e) => e.value === primaryType)) {
      const idx = cats.indexOf("movies_theatre");
      cats.splice(idx, 1);
      modified = true;
      modifyReason = `Rules: stripped 'movies_theatre' — primary_type '${primaryType}' is not a cinema or performance venue`;
      modifyVersionId = r9.rule_set_version_id;
    }
  }

  // 7c. BRUNCH_CASUAL_BLOCKED_TYPES (with RESTAURANT_TYPES exemption)
  const r10 = lookupActive("BRUNCH_CASUAL_BLOCKED_TYPES");
  if (r10 && cats.includes("brunch_lunch_casual")) {
    const blockedSet = new Set(r10.entries.map((e) => e.value));
    const hasBlocked = typesArray.some((t) => blockedSet.has(t));
    const isRealRestaurant = (r6Restaurants?.entries.some((e) => e.value === primaryType) ?? false)
      || ["brunch_restaurant", "breakfast_restaurant", "bistro", "diner", "family_restaurant"].includes(primaryType);
    if (hasBlocked && !isRealRestaurant) {
      const idx = cats.indexOf("brunch_lunch_casual");
      cats.splice(idx, 1);
      modified = true;
      modifyReason = `Rules: stripped 'brunch_lunch_casual' — types array contains non-restaurant type, primary is '${primaryType}'`;
      modifyVersionId = r10.rule_set_version_id;
    }
  }

  // 7d. PLAY_BLOCKED_SECONDARY_TYPES
  const r11 = lookupActive("PLAY_BLOCKED_SECONDARY_TYPES");
  if (r11 && cats.includes("play")) {
    const blockedSet = new Set(r11.entries.map((e) => e.value));
    if (typesArray.some((t) => blockedSet.has(t))) {
      const idx = cats.indexOf("play");
      cats.splice(idx, 1);
      modified = true;
      modifyReason = `Rules: stripped 'play' — types array contains non-play type`;
      modifyVersionId = r11.rule_set_version_id;
    }
  }

  // 7e. FLOWERS strip (multiple combined rules)
  const r12pri = lookupActive("FLOWERS_BLOCKED_PRIMARY_TYPES");
  const r12sec = lookupActive("FLOWERS_BLOCKED_SECONDARY_TYPES");
  const r12garden = lookupActive("GARDEN_STORE_PATTERNS");
  if (cats.includes("flowers")) {
    let hasBlockedFlowerType = false;
    let isGardenStore = false;
    if (r12pri && r12pri.entries.some((e) => e.value === primaryType)) hasBlockedFlowerType = true;
    if (r12sec) {
      const sec = new Set(r12sec.entries.map((e) => e.value));
      if (typesArray.some((t) => sec.has(t))) hasBlockedFlowerType = true;
    }
    if (r12garden && r12garden.entries.some((e) => name.toLowerCase().includes(e.value))) {
      isGardenStore = true;
    }
    if (hasBlockedFlowerType || (isGardenStore && primaryType !== "florist")) {
      const idx = cats.indexOf("flowers");
      if (idx >= 0) {
        cats.splice(idx, 1);
        modified = true;
        modifyReason = hasBlockedFlowerType
          ? `Rules: stripped 'flowers' — blocked type (primary: '${primaryType}')`
          : `Rules: stripped 'flowers' — garden store name pattern detected`;
        modifyVersionId = (r12pri || r12sec || r12garden)?.rule_set_version_id || null;
      }
    }
  }

  // 8. DELIVERY_ONLY_PATTERNS
  const r13 = lookupActive("DELIVERY_ONLY_PATTERNS");
  if (r13 && cats.includes("flowers") && primaryType !== "florist") {
    if (r13.entries.some((e) => name.toLowerCase().includes(e.value))) {
      const idx = cats.indexOf("flowers");
      if (idx >= 0) {
        cats.splice(idx, 1);
        modified = true;
        modifyReason = `Rules: delivery-only pattern in name, not a florist — stripped 'flowers'`;
        modifyVersionId = r13.rule_set_version_id;
      }
    }
  }

  if (modified) {
    if (cats.length === 0) {
      return {
        verdict: "reject",
        reason: modifyReason + " — no remaining categories, rejected",
        categories: [],
        stageResolved: 2,
        ruleSetVersionId: modifyVersionId,
      };
    }
    return {
      verdict: "modify",
      reason: modifyReason,
      categories: cats,
      stageResolved: 2,
      ruleSetVersionId: modifyVersionId,
    };
  }

  return { verdict: "pass", ruleSetVersionId: null };
}

// ── Process Single Place (Stages 2-5) ────────────────────────────────────────

interface PlaceResult {
  decision: string;
  categories: string[];
  primary_identity: string;
  confidence: string;
  reason: string;
  evidence: string;
  stage_resolved: number;
  website_verified: boolean;
  search_results: SerperResult[];
  cost_usd: number;
}

async function processPlace(place: any): Promise<PlaceResult> {
  // Stage 2: Deterministic
  const preFilter = deterministicFilter(place);
  if (preFilter.verdict !== "pass") {
    return {
      decision: preFilter.verdict === "modify" ? "reclassify" : preFilter.verdict,
      categories: preFilter.categories || [],
      primary_identity: place.primary_type || "unknown",
      confidence: "high",
      reason: preFilter.reason || "",
      evidence: "",
      stage_resolved: preFilter.stageResolved || 2,
      website_verified: false,
      search_results: [],
      cost_usd: 0,
    };
  }

  // Stage 3: Serper search
  let searchResults: SerperResult[] = [];
  let serperCost = 0;
  try {
    searchResults = await searchPlace(place.name, place.address || "");
    serperCost = 0.0004;
  } catch (err) {
    console.error(`Serper failed for ${place.id}: ${(err as Error).message}`);
  }

  // Stage 4: Website
  const ownedDomain = extractOwnedDomain(searchResults);
  let websiteResolves = false;
  if (ownedDomain) {
    websiteResolves = await verifyWebsite(ownedDomain.url);
  }

  // Stage 5: GPT classification
  const factSheet = {
    name: place.name,
    type: place.primary_type,
    cats: place.ai_categories || [],
    price: place.price_level || "unknown",
    rating: place.rating,
    reviews: place.review_count || 0,
    web: ownedDomain?.domain || null,
    hours: !!place.opening_hours,
    evidence: searchResults.slice(0, 3).map((r) => `${r.title}: ${r.snippet}`).join(" | ").slice(0, 650),
  };

  let gptCost = 0;
  try {
    const result = await classifyPlace(factSheet);
    gptCost = (result.input_tokens * 0.00000015) + (result.output_tokens * 0.0000006);

    let decision = result.decision;
    if (decision === "accept") {
      // Check if categories changed — if so, it's a reclassify
      const oldCats = [...(place.ai_categories || [])].sort().join(",");
      const newCats = [...result.categories].sort().join(",");
      if (oldCats !== newCats && oldCats.length > 0) decision = "reclassify";
    }

    return {
      decision,
      categories: decision === "reject" ? [] : result.categories,
      primary_identity: result.primary_identity,
      confidence: result.confidence,
      reason: `Pipeline v1: ${result.reason}`,
      evidence: factSheet.evidence.slice(0, 500),
      stage_resolved: 5,
      website_verified: result.website_verified,
      search_results: searchResults,
      cost_usd: serperCost + gptCost,
    };
  } catch (err) {
    // Propagate quota errors so the batch handler can return 402
    if ((err as Error).message?.includes("QUOTA_EXCEEDED")) throw err;
    // Re-throw all other GPT errors — place stays ai_approved=NULL, retryable
    console.error(`GPT failed for ${place.id}: ${(err as Error).message}`);
    throw err;
  }
}

// ── Auth Check ───────────────────────────────────────────────────────────────

async function checkAdmin(req: Request): Promise<{ adminId: string; userId: string } | Response> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "Missing authorization" }, 401);
  const token = authHeader.replace("Bearer ", "");

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const supabase = createClient(supabaseUrl, supabaseAnonKey, { global: { headers: { Authorization: `Bearer ${token}` } } });

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return json({ error: "Invalid token" }, 401);

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const db = createClient(supabaseUrl, serviceKey);

  const { data: adminRow } = await db
    .from("admin_users")
    .select("id")
    .eq("email", user.email)
    .eq("status", "active")
    .maybeSingle();
  if (!adminRow) return json({ error: "Admin access required" }, 403);

  return { adminId: adminRow.id, userId: user.id };
}

function getDb() {
  return createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );
}

// ── Action Handlers ──────────────────────────────────────────────────────────

async function handlePreview(body: any): Promise<Response> {
  const db = getDb();
  const scope = body.scope || "unvalidated";
  const revalidate = body.revalidate || false;

  // Build query to count matching places (same logic as admin_ai_validation_preview RPC)
  let query = db.from("place_pool").select("id", { count: "exact", head: true }).eq("is_active", true);

  if (scope === "unvalidated" && !revalidate) {
    query = query.is("ai_approved", null);
  } else if (scope === "failed" && !revalidate) {
    query = query.not("ai_validated_at", "is", null).is("ai_approved", null);
  } else if (scope !== "all" && !revalidate) {
    query = query.is("ai_approved", null);
  }
  if (body.category) query = query.contains("ai_categories", [body.category]);
  if (body.country) query = query.ilike("country", `%${body.country}%`);
  if (body.city) query = query.ilike("city", `%${body.city}%`);
  if (body.city_id) query = query.eq("city_id", body.city_id);

  const { count, error } = await query;
  if (error) return json({ error: error.message }, 500);

  const placeCount = count || 0;
  const estSearchCost = placeCount * 0.85 * 0.0004;
  const estGptCost = placeCount * 0.85 * 0.0003;
  const estTotal = (estSearchCost + estGptCost) * 1.15;
  const estMinutes = Math.ceil(placeCount / 25) * 0.75;

  return json({
    places_to_process: placeCount,
    estimated_cost_usd: Math.round(estTotal * 100) / 100,
    estimated_minutes: Math.round(estMinutes),
    breakdown: {
      serper_cost: Math.round(estSearchCost * 10000) / 10000,
      gpt_cost: Math.round(estGptCost * 10000) / 10000,
      contingency_pct: 15,
    },
  });
}

async function handleCreateRun(body: any, userId: string): Promise<Response> {
  const db = getDb();
  const scope = body.scope || "unvalidated";
  const batchSize = Math.min(body.batch_size || 25, 50);

  try {
    // Check for existing active run
    const { data: activeRun } = await db
      .from("ai_validation_jobs")
      .select("id")
      .in("status", ["ready", "running", "paused"])
      .limit(1)
      .maybeSingle();
    if (activeRun) return json({ status: "already_active", run_id: activeRun.id });

    // Count matching places
    let countQuery = db.from("place_pool").select("id", { count: "exact", head: true }).eq("is_active", true);
    if (scope === "unvalidated" && !body.revalidate) countQuery = countQuery.is("ai_approved", null);
    else if (scope === "failed" && !body.revalidate) countQuery = countQuery.not("ai_validated_at", "is", null).is("ai_approved", null);
    else if (scope !== "all" && !body.revalidate) countQuery = countQuery.is("ai_approved", null);
    if (body.category) countQuery = countQuery.contains("ai_categories", [body.category]);
    if (body.city) countQuery = countQuery.ilike("city", `%${body.city}%`);
    if (body.city_id) countQuery = countQuery.eq("city_id", body.city_id);

    const { count: totalPlaces, error: countErr } = await countQuery;
    if (countErr) return json({ error: `Count failed: ${countErr.message}` }, 500);
    if (!totalPlaces || totalPlaces === 0) return json({ status: "nothing_to_do", total_places: 0 });

    const estCost = Math.round(totalPlaces * 0.85 * 0.0007 * 1.15 * 100) / 100;

    // Fetch all matching place IDs (paginated)
    const allIds: string[] = [];
    let offset = 0;
    while (true) {
      let idQuery = db.from("place_pool").select("id").eq("is_active", true).order("created_at", { ascending: true });
      if (scope === "unvalidated" && !body.revalidate) idQuery = idQuery.is("ai_approved", null);
      else if (scope === "failed" && !body.revalidate) idQuery = idQuery.not("ai_validated_at", "is", null).is("ai_approved", null);
      else if (scope !== "all" && !body.revalidate) idQuery = idQuery.is("ai_approved", null);
      if (body.category) idQuery = idQuery.contains("ai_categories", [body.category]);
      if (body.city) idQuery = idQuery.ilike("city", `%${body.city}%`);
      if (body.city_id) idQuery = idQuery.eq("city_id", body.city_id);
      idQuery = idQuery.range(offset, offset + 999);

      const { data: page, error: pageErr } = await idQuery;
      if (pageErr) return json({ error: `ID fetch failed: ${pageErr.message}` }, 500);
      allIds.push(...(page || []).map((p: any) => p.id));
      if (!page || page.length < 1000) break;
      offset += 1000;
    }

  const totalBatches = Math.ceil(allIds.length / batchSize);

  // Create job
  const { data: job, error: jobErr } = await db
    .from("ai_validation_jobs")
    .insert({
      status: "ready",
      scope,
      total_places: allIds.length,
      processed: 0,
      approved: 0,
      rejected: 0,
      failed: 0,
      category_filter: body.category || null,
      country_filter: body.country || null,
      city_filter: body.city || null,
      dry_run: body.dry_run || false,
      batch_size: batchSize,
      total_batches: totalBatches,
      estimated_cost_usd: estCost,
      triggered_by: userId,
    })
    .select("id")
    .single();
  if (jobErr) return json({ error: jobErr.message }, 500);

  // Create batches
  const batchRows = [];
  for (let i = 0; i < allIds.length; i += batchSize) {
    const chunk = allIds.slice(i, i + batchSize);
    batchRows.push({
      run_id: job.id,
      batch_index: Math.floor(i / batchSize),
      place_pool_ids: chunk,
      place_count: chunk.length,
      status: "pending",
    });
  }

  // Insert batches in chunks of 100
  for (let i = 0; i < batchRows.length; i += 100) {
    const { error: bErr } = await db.from("ai_validation_batches").insert(batchRows.slice(i, i + 100));
    if (bErr) return json({ error: bErr.message }, 500);
  }

  return json({
    run_id: job.id,
    status: "ready",
    total_places: allIds.length,
    total_batches: totalBatches,
    estimated_cost_usd: estCost,
  });
  } catch (err) {
    console.error("handleCreateRun error:", err);
    return json({ error: `create_run failed: ${(err as Error).message}` }, 500);
  }
}

async function handleRunBatch(body: any): Promise<Response> {
  const db = getDb();
  const runId = body.run_id;
  if (!runId) return json({ error: "Missing run_id" }, 400);

  // Load run
  const { data: run, error: runErr } = await db
    .from("ai_validation_jobs")
    .select("*")
    .eq("id", runId)
    .single();
  if (runErr || !run) return json({ error: "Run not found" }, 404);
  if (!["ready", "running", "paused"].includes(run.status)) {
    return json({ error: `Run is ${run.status}, cannot process batches` }, 400);
  }

  // Set running
  if (run.status !== "running") {
    await db.from("ai_validation_jobs").update({
      status: "running",
      started_at: run.started_at || new Date().toISOString(),
    }).eq("id", runId);
  }

  // Stale batch detection
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const { data: staleBatches } = await db
    .from("ai_validation_batches")
    .select("id")
    .eq("run_id", runId)
    .eq("status", "running")
    .lt("started_at", fiveMinAgo);
  for (const stale of staleBatches || []) {
    await db.from("ai_validation_batches")
      .update({ status: "failed", error_message: "Timed out (stuck >5 minutes)", completed_at: new Date().toISOString() })
      .eq("id", stale.id);
  }

  // Find next pending batch
  const { data: nextBatch } = await db
    .from("ai_validation_batches")
    .select("*")
    .eq("run_id", runId)
    .eq("status", "pending")
    .order("batch_index", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!nextBatch) {
    // All done
    await db.from("ai_validation_jobs").update({
      status: "completed",
      stage: "complete",
      completed_at: new Date().toISOString(),
    }).eq("id", runId);

    const { data: freshRun } = await db.from("ai_validation_jobs").select("*").eq("id", runId).single();
    return json({ done: true, run_progress: freshRun });
  }

  // Mark batch running
  await db.from("ai_validation_batches").update({
    status: "running",
    started_at: new Date().toISOString(),
  }).eq("id", nextBatch.id);

  // Update stage
  await db.from("ai_validation_jobs").update({ stage: "classify" }).eq("id", runId);

  // Process each place
  let accepted = 0, rejected = 0, reclassified = 0, lowConf = 0, failedPlaces = 0;
  let batchCost = 0;

  for (const placeId of nextBatch.place_pool_ids) {
    // Load place
    const { data: place } = await db
      .from("place_pool")
      .select("id, name, address, primary_type, types, rating, review_count, price_level, website, editorial_summary, ai_categories, opening_hours")
      .eq("id", placeId)
      .single();

    if (!place) { failedPlaces++; continue; }

    let result: PlaceResult;
    try {
      result = await processPlace(place);
    } catch (err) {
      const msg = (err as Error).message || "";
      // Quota exceeded: save progress, return 402 immediately
      if (msg.includes("QUOTA_EXCEEDED")) {
        await db.from("ai_validation_batches").update({
          status: "failed", error_message: msg, completed_at: new Date().toISOString(),
        }).eq("id", nextBatch.id);
        await db.from("ai_validation_jobs").update({
          status: "paused", error_message: "Auto-paused: OpenAI quota exceeded",
        }).eq("id", runId);
        return json({
          error: "OpenAI quota exceeded. Top up credits and retry.",
          code: "QUOTA_EXCEEDED",
          places_processed: accepted + rejected + reclassified + failedPlaces,
        }, 402);
      }
      console.error(`Process failed for ${placeId}: ${msg}`);
      failedPlaces++;
      continue;
    }

    // Determine decision type
    if (result.decision === "reject") rejected++;
    else if (result.decision === "reclassify") reclassified++;
    else accepted++;
    if (result.confidence === "low") lowConf++;
    batchCost += result.cost_usd;

    // Write to ai_validation_results
    await db.from("ai_validation_results").insert({
      job_id: runId,
      batch_id: nextBatch.id,
      place_id: placeId,
      decision: result.decision === "reclassify" ? "reclassify" : result.decision,
      previous_categories: place.ai_categories || [],
      new_categories: result.categories,
      primary_identity: result.primary_identity,
      confidence: result.confidence,
      reason: result.reason,
      evidence: result.evidence,
      stage_resolved: result.stage_resolved,
      website_verified: result.website_verified,
      search_results: result.search_results,
      cost_usd: result.cost_usd,
    });

    // Write to place_pool (skip if dry_run)
    if (!run.dry_run) {
      const confNum = result.confidence === "high" ? 0.95 : result.confidence === "medium" ? 0.7 : 0.4;
      await db.from("place_pool").update({
        ai_approved: result.decision !== "reject",
        ai_categories: result.categories,
        ai_primary_identity: result.primary_identity,
        ai_confidence: confNum,
        ai_reason: result.reason,
        ai_web_evidence: result.evidence.slice(0, 500),
        ai_validated_at: new Date().toISOString(),
      }).eq("id", placeId);
    }

    // Small delay between places
    await sleep(200);
  }

  // Update batch
  await db.from("ai_validation_batches").update({
    status: "completed",
    completed_at: new Date().toISOString(),
    accepted,
    rejected,
    reclassified,
    low_confidence: lowConf,
    failed_places: failedPlaces,
  }).eq("id", nextBatch.id);

  // Re-read run and update counters
  const { data: freshRun } = await db.from("ai_validation_jobs").select("*").eq("id", runId).single();
  const newProcessed = (freshRun?.processed || 0) + nextBatch.place_count;
  const newApproved = (freshRun?.approved || 0) + accepted;
  const newRejected = (freshRun?.rejected || 0) + rejected;
  const newReclassified = (freshRun?.reclassified || 0) + reclassified;
  const newLowConf = (freshRun?.low_confidence || 0) + lowConf;
  const newFailed = (freshRun?.failed || 0) + failedPlaces;
  const newCost = (freshRun?.cost_usd || 0) + batchCost;
  const newCompBatches = (freshRun?.completed_batches || 0) + 1;

  const updates: any = {
    processed: newProcessed,
    approved: newApproved,
    rejected: newRejected,
    reclassified: newReclassified,
    low_confidence: newLowConf,
    failed: newFailed,
    cost_usd: newCost,
    completed_batches: newCompBatches,
  };

  // Check if all batches done
  const { count: pendingCount } = await db
    .from("ai_validation_batches")
    .select("id", { count: "exact", head: true })
    .eq("run_id", runId)
    .eq("status", "pending");

  if (pendingCount === 0) {
    updates.status = "completed";
    updates.stage = "complete";
    updates.completed_at = new Date().toISOString();
  }

  // Cost guardrail
  if (freshRun?.estimated_cost_usd && newCost > freshRun.estimated_cost_usd * 2) {
    updates.status = "paused";
    updates.error_message = "Auto-paused: cost exceeded 2x estimate";
  }

  await db.from("ai_validation_jobs").update(updates).eq("id", runId);

  const { data: finalRun } = await db.from("ai_validation_jobs").select("*").eq("id", runId).single();

  return json({
    batch_id: nextBatch.id,
    batch_index: nextBatch.batch_index,
    accepted,
    rejected,
    reclassified,
    low_confidence: lowConf,
    failed: failedPlaces,
    cost_usd: batchCost,
    done: updates.status === "completed",
    auto_paused: updates.status === "paused" && updates.error_message?.includes("cost"),
    run_progress: finalRun,
  });
}

async function handleRunStatus(body: any): Promise<Response> {
  const db = getDb();
  const runId = body.run_id;
  if (!runId) return json({ error: "Missing run_id" }, 400);

  const { data: run, error: runErr } = await db
    .from("ai_validation_jobs").select("*").eq("id", runId).single();
  if (runErr || !run) return json({ error: "Run not found" }, 404);

  const { data: batches } = await db
    .from("ai_validation_batches")
    .select("id, batch_index, status, place_count, accepted, rejected, reclassified, low_confidence, failed_places, started_at, completed_at, error_message")
    .eq("run_id", runId)
    .order("batch_index");

  return json({ run, batches: batches || [] });
}

async function handleGetResults(body: any): Promise<Response> {
  const db = getDb();
  const page = body.page || 1;
  const pageSize = body.page_size || 50;
  const offset = (page - 1) * pageSize;

  // Find job ID (use provided or latest completed)
  let jobId = body.job_id;
  if (!jobId) {
    const { data: latest } = await db.from("ai_validation_jobs")
      .select("id").eq("status", "completed").order("completed_at", { ascending: false }).limit(1).maybeSingle();
    jobId = latest?.id;
  }
  if (!jobId) return json({ results: [], total_count: 0, page, page_size: pageSize });

  let query = db.from("ai_validation_results")
    .select("id, place_id, decision, previous_categories, new_categories, primary_identity, confidence, reason, evidence, stage_resolved, website_verified, overridden, override_decision, override_categories, override_reason, overridden_at, created_at", { count: "exact" })
    .eq("job_id", jobId)
    .order("created_at", { ascending: false });

  if (body.decision) query = query.eq("decision", body.decision);
  if (body.category) query = query.contains("new_categories", [body.category]);
  if (body.confidence) query = query.eq("confidence", body.confidence);
  query = query.range(offset, offset + pageSize - 1);

  const { data: results, count, error } = await query;
  if (error) return json({ error: error.message }, 500);

  // Fetch place names for results
  const placeIds = (results || []).map((r: any) => r.place_id).filter(Boolean);
  const placeNames: Record<string, { name: string; address: string }> = {};
  if (placeIds.length > 0) {
    const { data: places } = await db.from("place_pool").select("id, name, address").in("id", placeIds);
    for (const p of places || []) placeNames[p.id] = { name: p.name, address: p.address };
  }

  const enriched = (results || []).map((r: any) => ({
    ...r,
    place_name: placeNames[r.place_id]?.name || "Unknown",
    place_address: placeNames[r.place_id]?.address || "",
  }));

  return json({ results: enriched, total_count: count || 0, page, page_size: pageSize });
}

async function handleReviewQueue(body: any): Promise<Response> {
  const db = getDb();
  const filter = body.filter || "all";
  const page = body.page || 1;
  const pageSize = body.page_size || 20;
  const offset = (page - 1) * pageSize;

  let jobId = body.job_id;
  if (!jobId) {
    const { data: latest } = await db.from("ai_validation_jobs")
      .select("id").in("status", ["completed", "running"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
    jobId = latest?.id;
  }
  if (!jobId) return json({ items: [], total_count: 0, low_confidence: 0, reclassified: 0, overridden: 0, page, page_size: pageSize });

  let query = db.from("ai_validation_results")
    .select("id, place_id, decision, previous_categories, new_categories, primary_identity, confidence, reason, evidence, overridden, override_decision, override_categories, override_reason, overridden_at, created_at", { count: "exact" })
    .eq("job_id", jobId);

  if (filter === "low_confidence") query = query.eq("confidence", "low").eq("overridden", false);
  else if (filter === "reclassified") query = query.eq("decision", "reclassify").eq("overridden", false);
  else if (filter === "overridden") query = query.eq("overridden", true);
  else query = query.or("confidence.eq.low,decision.eq.reclassify,overridden.eq.true");

  query = query.order("created_at", { ascending: false }).range(offset, offset + pageSize - 1);
  const { data: items, count, error } = await query;
  if (error) return json({ error: error.message }, 500);

  // Enrich with place names
  const placeIds = (items || []).map((r: any) => r.place_id).filter(Boolean);
  const placeNames: Record<string, { name: string; address: string }> = {};
  if (placeIds.length > 0) {
    const { data: places } = await db.from("place_pool").select("id, name, address").in("id", placeIds);
    for (const p of places || []) placeNames[p.id] = { name: p.name, address: p.address };
  }

  const enriched = (items || []).map((r: any) => ({
    ...r,
    place_name: placeNames[r.place_id]?.name || "Unknown",
    place_address: placeNames[r.place_id]?.address || "",
  }));

  return json({ items: enriched, total_count: count || 0, page, page_size: pageSize });
}

async function handleOverride(body: any): Promise<Response> {
  const db = getDb();
  const resultId = body.result_id;
  const decision = body.decision;
  if (!resultId || !decision) return json({ error: "Missing result_id or decision" }, 400);
  if (!["accept", "reject", "reclassify"].includes(decision)) return json({ error: "Invalid decision" }, 400);

  // Get place_id from result
  const { data: result } = await db.from("ai_validation_results").select("place_id").eq("id", resultId).single();
  if (!result) return json({ error: "Result not found" }, 404);

  // Update result
  await db.from("ai_validation_results").update({
    overridden: true,
    override_decision: decision,
    override_categories: body.categories || null,
    override_reason: body.reason || null,
    overridden_at: new Date().toISOString(),
  }).eq("id", resultId);

  // Update place_pool
  const approved = decision === "accept" || (decision === "reclassify" && body.categories?.length > 0);
  await db.from("place_pool").update({
    ai_approved: approved,
    ai_categories: body.categories || [], // ORCH-0460: no exclusivity enforcement
    ai_reason: body.reason || "Admin override",
    ai_validated_at: new Date().toISOString(),
  }).eq("id", result.place_id);

  return json({ success: true, place_id: result.place_id });
}

async function handleStopRun(body: any): Promise<Response> {
  const db = getDb();
  const runId = body.run_id;

  const { data: run } = await db.from("ai_validation_jobs").select("status").eq("id", runId).single();
  if (!run || !["ready", "running", "paused"].includes(run.status)) {
    return json({ error: "Run is not active" }, 400);
  }

  // Skip all pending batches
  const { data: pendingBatches } = await db
    .from("ai_validation_batches")
    .select("id")
    .eq("run_id", runId)
    .eq("status", "pending");

  const skippedCount = (pendingBatches || []).length;
  for (const b of pendingBatches || []) {
    await db.from("ai_validation_batches").update({ status: "skipped" }).eq("id", b.id);
  }

  await db.from("ai_validation_jobs").update({
    status: "cancelled",
    completed_at: new Date().toISOString(),
    skipped_batches: skippedCount,
  }).eq("id", runId);

  const { data: finalRun } = await db.from("ai_validation_jobs").select("*").eq("id", runId).single();
  return json({ status: "cancelled", skipped_batches: skippedCount, run_progress: finalRun });
}

async function handlePauseRun(body: any): Promise<Response> {
  const db = getDb();
  const { data: run } = await db.from("ai_validation_jobs").select("status").eq("id", body.run_id).single();
  if (!run || run.status !== "running") return json({ error: "Run is not running" }, 400);

  await db.from("ai_validation_jobs").update({ status: "paused" }).eq("id", body.run_id);
  return json({ status: "paused", run_id: body.run_id });
}

async function handleResumeRun(body: any): Promise<Response> {
  const db = getDb();
  const { data: run } = await db.from("ai_validation_jobs").select("status").eq("id", body.run_id).single();
  if (!run || run.status !== "paused") return json({ error: "Run is not paused" }, 400);

  await db.from("ai_validation_jobs").update({ status: "running" }).eq("id", body.run_id);

  const { count } = await db
    .from("ai_validation_batches")
    .select("id", { count: "exact", head: true })
    .eq("run_id", body.run_id)
    .eq("status", "pending");

  return json({ status: "running", run_id: body.run_id, remaining_batches: count || 0 });
}

// ── Rules-Only Filter Handler ────────────────────────────────────────────────

// ── Rules-only run handler (refactored ORCH-0526 M2) ────────────────────────
// Bundles 5 bug fixes: ORCH-0512 retraction (stage='rules_only_complete' preserved),
// ORCH-0527 (unchanged counter populated, approved stays 0), ORCH-0529 (concurrency
// check via status='running' for same city — see implementation note), ORCH-0530
// (city_id FK populated alongside city_filter), and the core ORCH-0526 work
// (read rules from DB via loadRulesFromDb with in-code-constants fallback,
// per-place rule_set_version_id attribution).
//
// CONCURRENCY (ORCH-0529): the M1 advisory lock helpers (try/release_advisory_
// _lock_rules_run) were built but pg advisory locks don't span multiple HTTP
// calls cleanly in Deno + Supabase JS (each db.* is its own transaction).
// Using the same status='running'-for-same-city pattern as handleCreateRun
// (line 944-950) instead. Same effect: 409 on contention. The advisory lock
// RPCs remain available for future use.
async function handleRunRulesFilter(body: any, userId: string): Promise<Response> {
  const db = getDb();
  const scope = body.scope || "all";
  const batchSize = Math.min(body.batch_size || 100, 200); // larger batches OK — no API calls
  const lockToken = crypto.randomUUID();

  // ORCH-0529: concurrency check — refuse if another rules-only run is active
  // for the same city (or the same global scope when no city specified).
  let activeQuery = db.from("ai_validation_jobs")
    .select("id, status, city_id, city_filter, started_at")
    .in("stage", ["rules_only", "rules_only_complete"])
    .in("status", ["ready", "running", "paused"]);
  if (body.city_id) activeQuery = activeQuery.eq("city_id", body.city_id);
  else activeQuery = activeQuery.is("city_id", null);
  const { data: activeRun } = await activeQuery.limit(1).maybeSingle();
  if (activeRun) {
    return json({
      status: "already_running",
      message: "A rules-filter run is already active for this scope.",
      active_job_id: activeRun.id,
    }, 409);
  }

  // ORCH-0526: load rules from DB. Falls back to in-code constants if empty
  // (I-RULES-FALLBACK-SAFE — transition guard).
  const loaded = await loadRulesFromDb(db, body.rules_version_id || null);
  const rulesVersionId = loaded ? loaded.rulesVersionId : null;

  // Build query for matching places (count first)
  let countQuery = db.from("place_pool")
    .select("id", { count: "exact", head: true })
    .eq("is_active", true);
  if (scope === "unvalidated") countQuery = countQuery.is("ai_approved", null);
  else if (scope === "failed") countQuery = countQuery.not("ai_validated_at", "is", null).is("ai_approved", null);
  if (body.category) countQuery = countQuery.contains("ai_categories", [body.category]);
  if (body.city_id) countQuery = countQuery.eq("city_id", body.city_id);
  if (body.city) countQuery = countQuery.ilike("city", `%${body.city}%`);

  const { count: totalPlaces, error: countErr } = await countQuery;
  if (countErr) return json({ error: countErr.message }, 500);
  if (!totalPlaces || totalPlaces === 0) return json({ status: "nothing_to_do", total_places: 0 });

  // Create a job record for audit trail (ORCH-0530: city_id FK; ORCH-0527: unchanged=0 init)
  const { data: job, error: jobErr } = await db
    .from("ai_validation_jobs")
    .insert({
      status: "running",
      scope,
      total_places: totalPlaces,
      processed: 0,
      approved: 0,    // rules-only NEVER approves (ORCH-0527 — was misused as unchanged counter)
      rejected: 0,
      reclassified: 0,
      unchanged: 0,   // ORCH-0527: new column; tracks places left as-is
      failed: 0,
      category_filter: body.category || null,
      city_filter: body.city || null,
      city_id: body.city_id || null,         // ORCH-0530
      lock_token: lockToken,                 // ORCH-0529 (traceability — not used as actual lock per concurrency note above)
      rules_version_id: rulesVersionId,      // ORCH-0526 — null if loaded was null (transition guard)
      dry_run: body.dry_run || false,
      batch_size: batchSize,
      total_batches: Math.ceil(totalPlaces / batchSize),
      estimated_cost_usd: 0,
      triggered_by: userId,
      started_at: new Date().toISOString(),
      stage: "rules_only",
    })
    .select("id")
    .single();
  if (jobErr) return json({ error: jobErr.message }, 500);

  // Process in batches (paginated reads)
  let offset = 0;
  let totalProcessed = 0;
  let totalRejected = 0;
  let totalModified = 0;
  let totalUnchanged = 0;

  while (true) {
    let query = db.from("place_pool")
      .select("id, name, primary_type, types, rating, review_count, website, price_level, ai_categories, ai_approved")
      .eq("is_active", true)
      .order("created_at", { ascending: true })
      .range(offset, offset + batchSize - 1);

    if (scope === "unvalidated") query = query.is("ai_approved", null);
    else if (scope === "failed") query = query.not("ai_validated_at", "is", null).is("ai_approved", null);
    if (body.category) query = query.contains("ai_categories", [body.category]);
    if (body.city_id) query = query.eq("city_id", body.city_id);
    if (body.city) query = query.ilike("city", `%${body.city}%`);

    const { data: places, error: fetchErr } = await query;
    if (fetchErr) {
      console.error("Rules filter fetch error:", fetchErr.message);
      break;
    }
    if (!places || places.length === 0) break;

    for (const place of places) {
      // ORCH-0526: prefer DB-loaded rules; fall back to in-code constants if loadedRules
      // is null (transition guard — empty rule_sets table). Both paths produce identical
      // verdicts for v1; DB path additionally tags result with rule_set_version_id.
      const result: PreFilterResultDb = loaded
        ? deterministicFilterFromDb(place, loaded)
        : { ...deterministicFilter(place), ruleSetVersionId: null };
      totalProcessed++;

      if (result.verdict === "pass") {
        totalUnchanged++;
        continue; // No rule triggered — leave place as-is
      }

      // A rule triggered — write the result
      if (!body.dry_run) {
        if (result.verdict === "reject") {
          totalRejected++;
          await db.from("place_pool").update({
            ai_approved: false,
            ai_categories: [],
            ai_reason: result.reason,
            ai_validated_at: new Date().toISOString(),
          }).eq("id", place.id);
        } else if (result.verdict === "modify") {
          totalModified++;
          await db.from("place_pool").update({
            ai_categories: result.categories,
            ai_reason: result.reason,
            ai_validated_at: new Date().toISOString(),
          }).eq("id", place.id);
        } else if (result.verdict === "accept") {
          totalModified++;
          await db.from("place_pool").update({
            ai_approved: true,
            ai_categories: result.categories,
            ai_reason: result.reason,
            ai_validated_at: new Date().toISOString(),
          }).eq("id", place.id);
        }

        // Audit trail in ai_validation_results — ORCH-0526: ADD rule_set_version_id (V6 gap close)
        await db.from("ai_validation_results").insert({
          job_id: job.id,
          place_id: place.id,
          decision: result.verdict === "modify" ? "reclassify" : result.verdict,
          previous_categories: place.ai_categories || [],
          new_categories: result.categories || [],
          primary_identity: place.primary_type || "unknown",
          confidence: "high",
          reason: result.reason,
          evidence: "",
          stage_resolved: 2,
          website_verified: false,
          search_results: null,
          cost_usd: 0,
          rule_set_version_id: result.ruleSetVersionId || null,
        });
      } else {
        // Dry run — still count
        if (result.verdict === "reject") totalRejected++;
        else totalModified++;
      }
    }

    offset += batchSize;
  }

  // Finalize job (ORCH-0512 retraction: stage='rules_only_complete' preserves discriminator;
  // ORCH-0527: unchanged populated separately, approved stays 0 for rules-only runs).
  // DO NOT simplify stage to 'complete' — that destroys the rules-only-vs-AI distinction
  // used by admin Recent Runs filtering. Verified by spec test T-05.
  await db.from("ai_validation_jobs").update({
    status: "completed",
    stage: "rules_only_complete",
    processed: totalProcessed,
    rejected: totalRejected,
    reclassified: totalModified,
    approved: 0,                  // ORCH-0527: rules-only never approves
    unchanged: totalUnchanged,    // ORCH-0527: new column carries the no-op count
    cost_usd: 0,
    completed_at: new Date().toISOString(),
  }).eq("id", job.id);

  return json({
    status: "completed",
    run_id: job.id,
    rules_version_id: rulesVersionId,
    total_processed: totalProcessed,
    rejected: totalRejected,
    modified: totalModified,
    unchanged: totalUnchanged,
    cost_usd: 0,
    dry_run: body.dry_run || false,
  });
}

// ── ORCH-0526 M2: New action handlers ──────────────────────────────────────

// preview_rule_impact — delegates to admin_rules_preview_impact RPC
// (DRY: the PL/pgSQL RPC already implements per-rule isolated impact per
// Option 1 chosen 2026-04-19. Edge fn version exposes the same logic to
// non-admin-UI callers if needed in v2.)
//
// AUTH CONTEXT: admin_rules_preview_impact's first statement is an admin gate
// that checks auth.email(). The service-role client from getDb() would make
// auth.email() return NULL inside the RPC → gate fails. We create an
// auth-context client forwarding the user's JWT so the RPC sees the admin's
// email. (Note: checkAdmin has already validated the caller is active admin
// BEFORE this handler runs, so the RPC gate is belt-and-suspenders.)
async function handlePreviewRuleImpact(req: Request, body: any): Promise<Response> {
  if (!body.rule_set_id) return json({ error: "Missing rule_set_id" }, 400);
  if (!Array.isArray(body.proposed_entries)) return json({ error: "proposed_entries must be array" }, 400);

  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace("Bearer ", "");
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const authedDb = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data, error } = await authedDb.rpc("admin_rules_preview_impact", {
    p_rule_set_id: body.rule_set_id,
    p_proposed_entries: body.proposed_entries,
    p_proposed_thresholds: body.proposed_thresholds || null,
    p_city_id: body.city_id || null,
  });
  if (error) return json({ error: error.message }, 500);
  return json(data);
}

// get_rules_for_run — returns the full rule body for a specific manifest version
// (used by JSON export, run-diff, and any non-admin-UI consumer that needs the
// authoritative rule set for a specific job)
async function handleGetRulesForRun(body: any): Promise<Response> {
  const db = getDb();
  const loaded = await loadRulesFromDb(db, body.rules_version_id || null);
  if (!loaded) {
    return json({
      error: "No manifest found",
      hint: "rules_versions table is empty (transition guard); seed M2 may not have run",
    }, 404);
  }

  // Project to a flat shape for HTTP response
  const ruleSets = Object.values(loaded.byName).map((r) => ({
    id: r.rule_set_id,
    name: r.name,
    kind: r.kind,
    scope_kind: r.scope_kind,
    scope_value: r.scope_value,
    version_id: r.rule_set_version_id,
    is_active: r.is_active,
    thresholds: r.thresholds,
    entries: r.entries,
  }));

  return json({
    rules_version_id: loaded.rulesVersionId,
    manifest_label: loaded.manifestLabel,
    rule_sets: ruleSets,
  });
}

// run_drift_check (ORCH-0528, scoped to 3 sources per Amendment 1) — compares:
//   A: filter rules in DB (rule_sets.scope_value for category-scoped rules)
//   B: on-demand types from _shared/categoryPlaceTypes.ts (display-name keys)
//   C: display constants — hardcoded mirror of mingla-admin/src/constants/categories.js
//      (edge fn cannot see admin/, so the canonical 10 are mirrored here. The CI script
//      `scripts/validate-category-consistency.ts` (Amendment 1) catches drift here at
//      PR time. Together: two safety nets at the two moments drift can happen.)
async function handleRunDriftCheck(_body: any): Promise<Response> {
  const start = Date.now();
  const db = getDb();

  // C — canonical 10 slugs (mirror of mingla-admin/src/constants/categories.js).
  // Bundled at edge fn deploy. CI validates this matches the admin file.
  const DISPLAY_SLUGS: string[] = [
    "nature", "icebreakers", "drinks_and_music", "brunch_lunch_casual",
    "upscale_fine_dining", "movies_theatre", "creative_arts", "play",
    "flowers", "groceries",
  ];

  // Display-name → slug map for B (on-demand uses display names as keys)
  const DISPLAY_TO_SLUG: Record<string, string> = {
    "Nature & Views": "nature",
    "Icebreakers": "icebreakers",
    "Drinks & Music": "drinks_and_music",
    "Brunch, Lunch & Casual": "brunch_lunch_casual",
    "Upscale & Fine Dining": "upscale_fine_dining",
    "Movies & Theatre": "movies_theatre",
    "Creative & Arts": "creative_arts",
    "Play": "play",
    "Flowers": "flowers",
    "Groceries": "groceries",
  };

  // Load B (on-demand types) — dynamic import keeps drift_check failure non-fatal
  // if the shared file is missing/renamed.
  let ON_DEMAND: Record<string, string[]> = {};
  try {
    // deno-lint-ignore no-explicit-any
    const mod: any = await import("../_shared/categoryPlaceTypes.ts");
    ON_DEMAND = mod.MINGLA_CATEGORY_PLACE_TYPES || {};
  } catch (err) {
    return json({
      status: "error",
      error: `Could not load on-demand source: ${(err as Error).message}`,
      computed_in_ms: Date.now() - start,
    }, 500);
  }

  // Convert B's display-name keys to slugs
  const onDemandBySlug: Record<string, string[]> = {};
  for (const [displayName, types] of Object.entries(ON_DEMAND)) {
    const slug = DISPLAY_TO_SLUG[displayName];
    if (slug) onDemandBySlug[slug] = types;
  }

  // Load A — filter rules from DB (just need scope_value distribution + entries for
  // category-scoped strip/blacklist rules)
  const loaded = await loadRulesFromDb(db, null);
  if (!loaded) {
    return json({
      status: "error",
      error: "Filter rules empty (transition guard); cannot compute drift",
      computed_in_ms: Date.now() - start,
    }, 500);
  }

  // Filter category-scoped rules + their entries (only those types matter for drift comparison)
  const filterCatScopedRules = Object.values(loaded.byName).filter(
    (r) => r.scope_kind === "category" && r.scope_value !== null,
  );

  // Build a map of category-slug → set-of-types-on-strip-or-blacklist-rules
  const filterBlockedByCategory: Record<string, Set<string>> = {};
  for (const r of filterCatScopedRules) {
    if (!r.scope_value) continue;
    if (r.kind !== "strip" && r.kind !== "blacklist") continue;
    if (!filterBlockedByCategory[r.scope_value]) filterBlockedByCategory[r.scope_value] = new Set();
    for (const e of r.entries) {
      filterBlockedByCategory[r.scope_value].add(e.value);
    }
  }

  // Drift detection
  const diffs: Array<{
    category_slug: string;
    google_type: string | null;
    sources: { filter: string; on_demand: string; display: string };
    severity: "info" | "warning" | "error";
    suggestion: string;
  }> = [];

  // Check 1: every display category should exist in on-demand
  for (const slug of DISPLAY_SLUGS) {
    if (!(slug in onDemandBySlug)) {
      diffs.push({
        category_slug: slug,
        google_type: null,
        sources: { filter: "n/a", on_demand: "absent", display: "present" },
        severity: "warning",
        suggestion: `Display category '${slug}' has no on-demand fetch list. Add to _shared/categoryPlaceTypes.ts.`,
      });
    }
  }

  // Check 2: every on-demand category should be in display
  for (const slug of Object.keys(onDemandBySlug)) {
    if (!DISPLAY_SLUGS.includes(slug)) {
      diffs.push({
        category_slug: slug,
        google_type: null,
        sources: { filter: "n/a", on_demand: "present", display: "absent" },
        severity: "warning",
        suggestion: `On-demand category '${slug}' is not in admin display constants. Add or remove.`,
      });
    }
  }

  // Check 3: types fetched on-demand for category X should NOT be on a strip/blacklist
  // rule for the same category X (the contradiction case)
  for (const [slug, fetchedTypes] of Object.entries(onDemandBySlug)) {
    const blockedHere = filterBlockedByCategory[slug];
    if (!blockedHere) continue;
    for (const t of fetchedTypes) {
      if (blockedHere.has(t)) {
        diffs.push({
          category_slug: slug,
          google_type: t,
          sources: { filter: "blocked", on_demand: "present", display: "present" },
          severity: "error",
          suggestion: `Type '${t}' is fetched on-demand for '${slug}' but stripped by a filter rule for the same category. Pick one.`,
        });
      }
    }
  }

  let status: "in_sync" | "drift" | "contradiction" = "in_sync";
  if (diffs.some((d) => d.severity === "error")) status = "contradiction";
  else if (diffs.length > 0) status = "drift";

  return json({
    status,
    checked_at: new Date().toISOString(),
    source_versions: {
      filter_rules_version_id: loaded.rulesVersionId,
      on_demand_bundle: "categoryPlaceTypes.ts (current edge fn deploy)",
      display_bundle: "categories.js (mirror in edge fn)",
    },
    diffs,
    computed_in_ms: Date.now() - start,
  });
}

// ── Main Handler ─────────────────────────────────────────────────────────────

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authResult = await checkAdmin(req);
    if (authResult instanceof Response) return authResult;

    const body = await req.json();
    const action = body.action;

    switch (action) {
      case "preview":      return handlePreview(body);
      case "create_run":   return handleCreateRun(body, authResult.userId);
      case "run_batch":    return handleRunBatch(body);
      case "run_status":   return handleRunStatus(body);
      case "get_results":  return handleGetResults(body);
      case "review_queue": return handleReviewQueue(body);
      case "override":     return handleOverride(body);
      case "stop_run":     return handleStopRun(body);
      case "pause_run":    return handlePauseRun(body);
      case "resume_run":   return handleResumeRun(body);
      case "run_rules_filter":   return handleRunRulesFilter(body, authResult.userId);
      // ORCH-0526 M2: 3 new actions powering the Rules Filter admin tab
      case "preview_rule_impact": return handlePreviewRuleImpact(req, body);
      case "get_rules_for_run":   return handleGetRulesForRun(body);
      case "run_drift_check":     return handleRunDriftCheck(body);
      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (err) {
    console.error("ai-verify-pipeline error:", err);
    return json({ error: (err as Error).message || "Internal error" }, 500);
  }
});

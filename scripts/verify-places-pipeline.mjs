#!/usr/bin/env node

/**
 * Mingla Place Verification Pipeline v1
 *
 * 7-stage pipeline that verifies all approved places in place_pool:
 *   1. Export from Supabase
 *   2. Deterministic pre-filter (free)
 *   3. Serper.dev web search (~$0.0004/query)
 *   4. Website extraction & verification
 *   5. GPT-5.4-mini classification (~$0.00015/place)
 *   6. Write results to database
 *   7. Summary & output
 *
 * Usage:
 *   node scripts/verify-places-pipeline.mjs --dry-run --limit 50
 *   node scripts/verify-places-pipeline.mjs --category fine_dining --limit 100
 *   node scripts/verify-places-pipeline.mjs --resume
 */

import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUTS_DIR = resolve(__dirname, '..', 'outputs');

// ── Environment ──────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SERPER_API_KEY = process.env.SERPER_API_KEY;

function requireEnv() {
  const missing = [];
  if (!SUPABASE_URL) missing.push('SUPABASE_URL');
  if (!SUPABASE_SERVICE_ROLE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (!OPENAI_API_KEY) missing.push('OPENAI_API_KEY');
  if (!SERPER_API_KEY) missing.push('SERPER_API_KEY');
  if (missing.length > 0) {
    console.error(`Missing environment variables: ${missing.join(', ')}`);
    console.error('Set them in your shell or in a .env file in scripts/');
    process.exit(1);
  }
}

// ── CLI Argument Parsing ─────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    dryRun: false,
    limit: 0,
    category: '',
    country: '',
    city: '',
    skipSearch: false,
    resume: false,
    random: false,
    offset: 0,
    output: resolve(OUTPUTS_DIR, 'pipeline_results.jsonl'),
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--dry-run': opts.dryRun = true; break;
      case '--limit': opts.limit = parseInt(args[++i], 10); break;
      case '--category': opts.category = args[++i]; break;
      case '--country': opts.country = args[++i]; break;
      case '--city': opts.city = args[++i]; break;
      case '--skip-search': opts.skipSearch = true; break;
      case '--resume': opts.resume = true; break;
      case '--random': opts.random = true; break;
      case '--offset': opts.offset = parseInt(args[++i], 10); break;
      case '--output': opts.output = resolve(args[++i]); break;
      default:
        console.error(`Unknown flag: ${args[i]}`);
        process.exit(1);
    }
  }
  return opts;
}

// ── Constants: Blacklists & Keywords ─────────────────────────────────────────

const FAST_FOOD_BLACKLIST = [
  'mcdonald', 'burger king', 'kfc', 'kentucky fried', "wendy's", 'subway',
  'taco bell', 'chick-fil-a', 'five guys', 'popeyes', 'panda express',
  "domino's", 'papa john', 'pizza hut', 'little caesar', 'sonic drive',
  'jack in the box', "arby's", "carl's jr", 'hardee', 'del taco',
  "raising cane", 'whataburger', 'in-n-out', 'wingstop', 'chipotle',
  'shake shack', 'checkers', "rally's", "church's chicken", 'el pollo loco',
  'golden corral', 'bojangles', 'cook out', 'zaxby',
  'panera bread', 'jersey mike', 'jimmy john', 'firehouse sub',
  'qdoba', 'potbelly', 'sweetgreen', 'tropical smoothie',
  "moe's southwest", 'cava ',
  'starbucks', 'dunkin', 'tim horton', 'costa coffee', 'krispy kreme',
  'greggs', 'pret a manger',
  'quick ', 'nordsee',
  "baskin-robbins", 'cold stone creamery', 'häagen-dazs', 'insomnia cookies',
  'crumbl', 'smoothie king', "nothing bundt", "rita's italian ice",
  'jollibee', 'pollo tropical', 'pollo campero', 'telepizza',
];

const EXCLUSION_KEYWORDS = {
  medical: ['hospital', 'clinic', 'dentist', 'doctor', 'pharmacy', 'chiropractor',
            'physiotherapy', 'veterinary', 'optometrist', 'urgent care'],
  government: ['dmv', 'courthouse', 'post office', 'police station', 'embassy',
               'city hall', 'fire station'],
  education: ['school', 'daycare', 'preschool', 'tutoring', 'university campus'],
  grooming: ['threading', 'waxing studio', 'lash extension', 'microblading',
             'permanent makeup', 'nail salon', 'hair salon', 'barber',
             'kosmetikstudio', 'institut de beauté', 'beauty parlour',
             'tanning studio', 'brow bar', 'beauty salon', 'beauty lounge',
             'beauty world', 'beauty bar', 'med spa', 'medspa',
             'aesthetics spa', 'aesthetic clinic', 'beauty studio'],
  fitness: ['fitness center', 'crossfit', 'yoga studio', 'pilates',
            'martial arts dojo', 'boxing gym'],
  kids: ['kids play', "children's", 'indoor playground', 'kidz',
         'chuck e. cheese', 'kidzone', 'enfants', 'kinder', 'bambini',
         'infantil', 'splash pad', 'soft play'],
  utilitarian: ['gas station', 'car wash', 'laundromat', 'storage unit',
                'parking garage', 'auto repair', 'car dealership'],
  delivery: ['ghost kitchen', 'delivery only', 'cloud kitchen', 'virtual kitchen'],
  food_truck: ['food truck', 'food cart', 'mobile kitchen'],
  not_venue: ['real estate', 'insurance', 'accounting', 'law firm', 'consulting',
              'contractor', 'plumber', 'electrician', 'production company',
              'booking agency', 'talent agency', 'event management'],
  gambling: ['spielhalle', 'betting shop', 'slot machine', 'gambling hall'],
  allotment: ['kleingartenanlage', 'kleingarten', 'kolonie', 'schrebergarten',
              'allotment garden', 'jardin partagé', 'community garden', 'volkstuinen'],
};

const CASUAL_CHAIN_DEMOTION = [
  'olive garden', 'red lobster', 'outback', 'cheesecake factory',
  'applebee', "chili's", 'tgi friday', "denny's", 'ihop', 'waffle house',
  'cracker barrel', 'texas roadhouse', 'red robin', 'buffalo wild wings',
  'longhorn steakhouse', "nando's", 'wagamama', 'yo! sushi',
  'pizza express', 'pizzaexpress', 'hippopotamus',
];

const UPSCALE_CHAINS = [
  'nobu', "morton's", 'nusr-et', "perry's steakhouse",
  'stk steakhouse', "smith & wollensky",
];

const WEBSITE_REQUIRED_CATEGORIES = [
  'fine_dining', 'watch', 'live_performance', 'creative_arts', 'play', 'wellness',
];

const SOCIAL_DOMAINS = [
  'google.com', 'maps.google.com', 'facebook.com', 'instagram.com',
  'twitter.com', 'x.com', 'yelp.com', 'tripadvisor.com', 'foursquare.com',
  'youtube.com', 'tiktok.com', 'linkedin.com', 'pinterest.com',
  'fresha.com', 'treatwell.com', 'treatwell.co.uk', 'treatwell.de',
  'groupon.com', 'booksy.com', 'planity.com', 'vagaro.com',
  'classpass.com', 'mindbody.com', 'wikipedia.org', 'wikidata.org',
  'yellowpages.com', 'yell.com', 'pagesjaunes.fr', 'dasoertliche.de',
];

// ── GPT Classification Schema & Prompt ───────────────────────────────────────

const CLASSIFICATION_SCHEMA = {
  type: 'object',
  properties: {
    d: { type: 'string', enum: ['accept', 'reject', 'reclassify'] },
    c: { type: 'array', items: { type: 'string' } },
    pi: { type: 'string' },
    w: { type: 'boolean' },
    r: { type: 'string' },
    f: { type: 'string', enum: ['high', 'medium', 'low'] },
  },
  required: ['d', 'c', 'pi', 'w', 'r', 'f'],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `You classify places for Mingla, a dating app, into 13 categories.

CATEGORIES (* = must have candidate_website to qualify):
flowers, *fine_dining, nature_views, first_meet, drink, casual_eats, *watch, *live_performance, *creative_arts, *play, *wellness, picnic_park, groceries

CORE RULES:
- Determine what this place PRIMARILY IS first (restaurant, museum, bar, park, etc.)
- Only assign categories where the match is OBVIOUS. Default is zero categories.
- A museum with a cafe is creative_arts, NOT casual_eats.
- A park with a kiosk is nature_views+picnic_park, NOT drink.
- If a place fits a category, ASSIGN it. Do not reject places that clearly match a category definition.

CATEGORY DEFINITIONS:

FINE_DINING: A restaurant that feels like a special occasion. The combination of: upscale ambience, high-end cuisine, reservation culture, and elevated service. You do NOT need to find the chef's name in the search results — many acclaimed restaurants don't lead with the chef in Google snippets. Signals that indicate fine_dining: very high ratings (4.5+) with upscale reviews, $$$/$$$$ pricing, words like "upscale", "elegant", "tasting menu", "sommelier", "Michelin", "acclaimed", "refined". Examples that ARE fine_dining: Zuma, Manhatta, Nobu, Le Bernardin, Alinea, any Michelin-starred restaurant, any restaurant described as upscale/elegant/refined with high ratings. Examples that are NOT fine_dining: wine bars, tapas bars, bistros, brasseries (especially Parisian bouillons), gastropubs, charming but casual restaurants. Being a chain does NOT disqualify if the experience is genuinely upscale. Olive Garden/Cheesecake Factory fail. Nobu/Morton's pass. When genuinely uncertain, default to casual_eats.

CASUAL_EATS: Any real sit-down restaurant where you'd grab a meal. Includes chain restaurants with table service (Olive Garden, IHOP, Outback). Includes food halls and food markets with vendors. NO fast food/counter-service/grab-and-go chains (McDonald's, Subway, Starbucks). Wine bars and tapas bars with food → casual_eats + drink.

DRINK: Bars, cocktail bars, wine bars, breweries, beer gardens, pubs, speakeasies, rooftop bars, nightclubs, hookah bars, wineries. If the primary draw is drinks and social atmosphere, it's drink.

FIRST_MEET: Cafes, coffee shops, tea houses, bakeries with seating, bookstore cafes, ice cream parlors, juice bars. Any casual low-pressure spot for a 45-minute conversation.

WATCH: Real cinemas with screens and scheduled movies — movie theaters, indie cinemas, drive-ins, IMAX, AMC, Regal, Cinemark, Alamo Drafthouse. NO film production companies, NO festival offices. If it shows movies to audiences, it's watch.

PLAY: Active fun for adults — bowling, arcades, escape rooms (indoor AND outdoor), go-karts, laser tag, karaoke, mini golf, axe throwing, TopGolf/golf simulators, trampoline parks (adult-friendly), VR experiences, rock climbing, kayaking, skydiving, scavenger hunts, outdoor adventure games. NO kids-only venues, NO gyms, NO gambling halls (exception: upscale casinos like Bellagio).

LIVE_PERFORMANCE: Stage + scheduled performers + audience — concert halls, theaters, opera houses, comedy clubs, jazz clubs, live music venues, amphitheaters. NO production companies, NO booking agencies, NO dance studios.

CREATIVE_ARTS: Museums (all types), art galleries, cultural centers with exhibits, sculpture parks, immersive art (teamLab, Meow Wolf), pottery/paint-and-sip studios open to public, planetariums, aquariums, visitable castles/landmarks. Aquarium → creative_arts + play.

WELLNESS: Spas (full-service day spas), saunas, hammams, massage studios, hot springs, float tanks, thermal baths, Korean spas, wellness retreats, resort hotels with spa facilities. NO salons, NO beauty parlours, NO nail/hair/waxing/lash studios, NO med spas (medical aesthetics), NO beauty lounges. CRITICAL: if the name contains "beauty", "aesthetics", "makeup", "cosmetic", "lash", "brow", "nail", "hair", "waxing", or "threading" → it is NOT wellness, it is personal grooming → REJECT entirely. A place called "Beauty Spa" or "Aesthetics Spa" is a salon, not a spa.

NATURE_VIEWS: Parks, trails, beaches, botanical gardens, scenic viewpoints, observation decks, waterfronts, bridges, harbors, nature preserves. Parks with grass also get picnic_park.

PICNIC_PARK: Parks with open lawns where you can lay a blanket. Almost always paired with nature_views.

GROCERIES: Grocery stores, supermarkets, specialty food stores, gourmet markets, butcher shops, cheese shops. Places where you buy food to take home or for a picnic.

FLOWERS: Florists, flower shops, flower bars. Large supermarkets with staffed floral departments (like Whole Foods) qualify for BOTH flowers and groceries.

REJECT if AND ONLY IF the place fits NO category at all: kids-only venue, fast food chain, permanently closed, not a venue (offices/consultants/contractors), personal grooming (salons/barbers/waxing), fitness (gyms/yoga), gambling halls, production companies, booking agencies.

RECLASSIFY (d:"reclassify"): If a place is in the WRONG category but fits a DIFFERENT valid category, use d:"reclassify" and provide the correct categories in c:[]. Example: a beauty salon classified as "wellness" → reclassify with c:[] (reject from wellness, fits no other category). A restaurant classified as "watch" → reclassify with c:["casual_eats"]. A hotel with a notable bar classified as "wellness" → reclassify with c:["drink"]. Always check if the place fits ANY category before fully rejecting.

IMPORTANT — do NOT reject places that match ANY valid category. Libraries, hotels, and horse complexes may not fit, but grocery stores, nightclubs, bakeries, food halls, cinemas, and pottery studios DO fit their respective categories.

*categories need candidate_website to be non-null. If candidate_website is null for a *category, do not assign that category.

If has_opening_hours is false AND the place is NOT a park/trail/beach/outdoor venue, set confidence to "medium" or lower.

WORKED EXAMPLES (learn the pattern):

Example 1: "Whole Foods Market" type:grocery_store → {"d":"accept","c":["groceries","flowers"],"pi":"grocery store","w":false,"r":"Grocery store with staffed floral department","f":"high"}

Example 2: "TopGolf" type:restaurant → {"d":"accept","c":["play","casual_eats"],"pi":"golf entertainment venue","w":true,"r":"Interactive golf simulator with restaurant — play + casual_eats","f":"high"}

Example 3: "AMC Southpoint 17" type:movie_theater → {"d":"accept","c":["watch"],"pi":"movie theater","w":true,"r":"Real cinema chain with multiple screens","f":"high"}

Example 4: "Barcelona Wine Bar" type:wine_bar → {"d":"accept","c":["casual_eats","drink"],"pi":"tapas wine bar","w":true,"r":"Tapas wine bar — casual_eats + drink, not fine_dining","f":"high"}

Example 5: "Morgan Street Food Hall" type:food_court → {"d":"accept","c":["casual_eats"],"pi":"food hall","w":true,"r":"Food hall with multiple vendors — casual_eats","f":"high"}

Example 6: "KidZania" type:amusement_center → {"d":"reject","c":[],"pi":"children's entertainment center","w":true,"r":"Kids-only venue — reject","f":"high"}

Example 7: "Legends Nightclub" type:night_club → {"d":"accept","c":["drink"],"pi":"nightclub","w":true,"r":"Nightclub — primary draw is drinks and social atmosphere","f":"high"}

Example 8: "Paris Baguette" type:bakery → {"d":"accept","c":["first_meet"],"pi":"bakery cafe","w":true,"r":"Bakery with seating — good first_meet spot","f":"high"}

Example 9: "Living Kiln Studio" type:art_studio → {"d":"accept","c":["creative_arts"],"pi":"pottery studio","w":true,"r":"Pottery studio open to public — creative_arts","f":"high"}

Example 10: "Planet Fitness" type:gym → {"d":"reject","c":[],"pi":"gym","w":true,"r":"Fitness center — reject","f":"high"}

Example 11: "The Umstead Hotel and Spa" type:resort_hotel → {"d":"accept","c":["wellness"],"pi":"resort hotel with spa","w":true,"r":"Resort with notable spa facilities — wellness","f":"high"}

Example 13: "Beauty Blinks Aesthetics/Spa" type:spa → {"d":"reject","c":[],"pi":"beauty salon","w":true,"r":"Beauty/aesthetics in name = personal grooming, not wellness — reject","f":"high"}

Example 14: "DAZZLNSBEAUTYLOUNGE" type:spa → {"d":"reject","c":[],"pi":"beauty lounge","w":true,"r":"Beauty lounge = personal grooming — reject","f":"high"}

Example 15: "U2 UNIQUE MED SPA" type:spa → {"d":"reject","c":[],"pi":"medical aesthetics clinic","w":true,"r":"Med spa = medical aesthetics, not relaxation wellness — reject","f":"high"}

Example 16: "Painting with a Twist" type:art_studio → {"d":"accept","c":["creative_arts"],"pi":"paint-and-sip studio","w":true,"r":"Public paint-and-sip studio — creative_arts","f":"high"}

Example 12: "Urban Air Trampoline Park" type:amusement_center → Consider carefully: if it has adult sessions and date-night events, it's play. If it's primarily for kids birthday parties, reject.

Example 17: "Soho Beach House" type:hotel → {"d":"accept","c":["drink","wellness"],"pi":"members club with pool bar and spa","w":true,"r":"Upscale beach club/hotel with bar, pool, and spa — drink + wellness","f":"medium"}
Note: Private/members clubs with bars, pools, restaurants, or spas still qualify for their respective categories. The membership model doesn't disqualify the venue.

Return ONLY valid JSON.`;

// ── Helpers ──────────────────────────────────────────────────────────────────

function nameMatches(name, list) {
  const lower = name.toLowerCase();
  return list.some(term => lower.includes(term.toLowerCase()));
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function retry(fn, { retries = 1, delay = 2000 } = {}) {
  try {
    return await fn();
  } catch (err) {
    if (retries <= 0) throw err;
    await sleep(delay);
    return retry(fn, { retries: retries - 1, delay });
  }
}

function loadJsonlCache(filepath) {
  const cache = new Map();
  if (!existsSync(filepath)) return cache;
  const lines = readFileSync(filepath, 'utf-8').split('\n').filter(Boolean);
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (obj.id) cache.set(obj.id, obj);
    } catch { /* skip malformed lines */ }
  }
  return cache;
}

function appendJsonl(filepath, obj) {
  appendFileSync(filepath, JSON.stringify(obj) + '\n');
}

function loadCheckpoint(filepath) {
  if (!existsSync(filepath)) return null;
  try {
    return JSON.parse(readFileSync(filepath, 'utf-8'));
  } catch { return null; }
}

function saveCheckpoint(filepath, data) {
  writeFileSync(filepath, JSON.stringify(data, null, 2));
}

// ── Stage 1: Export from Supabase ────────────────────────────────────────────

async function stage1Export(supabase, opts) {
  console.log('\n── Stage 1: Export from Supabase ──');

  let query = supabase
    .from('place_pool')
    .select('id, name, address, primary_type, types, rating, review_count, price_level, website, editorial_summary, ai_categories, ai_approved, opening_hours, city, country')
    .eq('is_active', true)
    .eq('ai_approved', true)
    .order('created_at', { ascending: true });

  if (opts.category) {
    query = query.contains('ai_categories', [opts.category]);
  }
  if (opts.country) {
    query = query.ilike('country', `%${opts.country}%`);
  }
  if (opts.city) {
    query = query.ilike('city', `%${opts.city}%`);
  }
  if (opts.limit > 0) {
    query = query.limit(opts.limit);
  }

  // Fetch in small pages to avoid statement timeout on large datasets
  const allPlaces = [];
  const PAGE_SIZE = 500;
  let from = 0;
  let hasMore = true;

  while (hasMore) {
    let pageQuery = supabase
      .from('place_pool')
      .select('id, name, address, primary_type, types, rating, review_count, price_level, website, editorial_summary, ai_categories, ai_approved, opening_hours, city, country')
      .eq('is_active', true)
      .eq('ai_approved', true)
      .order('created_at', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (opts.category) pageQuery = pageQuery.contains('ai_categories', [opts.category]);
    if (opts.country) pageQuery = pageQuery.ilike('country', `%${opts.country}%`);
    if (opts.city) pageQuery = pageQuery.ilike('city', `%${opts.city}%`);

    const { data, error } = await pageQuery;
    if (error) throw new Error(`Supabase export error (page ${from}): ${error.message}`);

    allPlaces.push(...data);
    hasMore = data.length === PAGE_SIZE;
    from += PAGE_SIZE;

    if (allPlaces.length % 5000 < PAGE_SIZE) {
      console.log(`  Exported ${allPlaces.length.toLocaleString()} places...`);
    }

    if (opts.limit > 0 && !opts.random && allPlaces.length >= opts.limit) {
      allPlaces.length = opts.limit;
      break;
    }
  }

  // If --random, shuffle the results before applying limit
  if (opts.random) {
    for (let i = allPlaces.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [allPlaces[i], allPlaces[j]] = [allPlaces[j], allPlaces[i]];
    }
    if (opts.limit > 0) allPlaces.length = Math.min(allPlaces.length, opts.limit);
  }

  // If --offset, skip first N places
  if (opts.offset > 0 && !opts.random) {
    allPlaces.splice(0, opts.offset);
    if (opts.limit > 0) allPlaces.length = Math.min(allPlaces.length, opts.limit);
  }

  // Category breakdown
  const catCounts = {};
  for (const p of allPlaces) {
    for (const cat of (p.ai_categories || [])) {
      catCounts[cat] = (catCounts[cat] || 0) + 1;
    }
  }
  console.log(`  Total places: ${allPlaces.length}`);
  console.log('  Category breakdown:', JSON.stringify(catCounts, null, 2));

  return allPlaces;
}

// ── Stage 2: Deterministic Pre-Filter ────────────────────────────────────────

function stage2PreFilter(places) {
  console.log('\n── Stage 2: Deterministic Pre-Filter ──');

  const results = { rejected: [], downgraded: [], upscaled: [], passed: [] };

  for (const place of places) {
    const name = place.name || '';
    const primaryType = place.primary_type || '';
    const checkText = `${name} ${primaryType}`.toLowerCase();

    // 2a: Fast food blacklist → REJECT
    if (nameMatches(name, FAST_FOOD_BLACKLIST)) {
      results.rejected.push({
        ...place,
        _verdict: 'reject',
        _reason: 'Pipeline: fast food chain — rejected',
        _stage: 2,
        _categories: [],
      });
      continue;
    }

    // 2b: Exclusion keywords → REJECT
    let excluded = false;
    for (const [category, keywords] of Object.entries(EXCLUSION_KEYWORDS)) {
      if (keywords.some(kw => checkText.includes(kw.toLowerCase()))) {
        results.rejected.push({
          ...place,
          _verdict: 'reject',
          _reason: `Pipeline: excluded type (${category}) — rejected`,
          _stage: 2,
          _categories: [],
        });
        excluded = true;
        break;
      }
    }
    if (excluded) continue;

    // 2c: Casual chain demotion (fine_dining → casual_eats)
    if (nameMatches(name, CASUAL_CHAIN_DEMOTION)) {
      const cats = [...(place.ai_categories || [])];
      const hadFineDining = cats.includes('fine_dining');
      if (hadFineDining) {
        const newCats = cats.filter(c => c !== 'fine_dining');
        if (!newCats.includes('casual_eats')) newCats.push('casual_eats');
        results.downgraded.push({
          ...place,
          _verdict: 'accept',
          _reason: 'Pipeline: sit-down chain — downgraded from fine_dining to casual_eats',
          _stage: 2,
          _categories: newCats,
        });
      } else {
        // Not in fine_dining, pass through unchanged
        results.passed.push(place);
      }
      continue;
    }

    // 2d: Upscale chain recognition
    if (nameMatches(name, UPSCALE_CHAINS)) {
      const cats = [...(place.ai_categories || [])];
      if (!cats.includes('fine_dining')) cats.push('fine_dining');
      results.upscaled.push({
        ...place,
        _verdict: 'accept',
        _reason: 'Pipeline: upscale chain — fine_dining confirmed',
        _stage: 2,
        _categories: cats,
      });
      continue;
    }

    // Passed all deterministic filters
    results.passed.push(place);
  }

  console.log(`  Rejected (fast food + excluded): ${results.rejected.length}`);
  console.log(`  Downgraded (casual chains): ${results.downgraded.length}`);
  console.log(`  Upscaled (upscale chains): ${results.upscaled.length}`);
  console.log(`  Passed to next stage: ${results.passed.length}`);

  return results;
}

// ── Stage 3: Serper.dev Web Search ───────────────────────────────────────────

async function stage3Search(places, opts) {
  console.log('\n── Stage 3: Serper.dev Web Search ──');

  if (opts.skipSearch) {
    console.log('  Skipped (--skip-search)');
    return new Map();
  }

  const cachePath = resolve(OUTPUTS_DIR, 'pipeline_search_cache.jsonl');
  const cache = loadJsonlCache(cachePath);
  console.log(`  Cache: ${cache.size} entries loaded`);

  const toSearch = places.filter(p => !cache.has(p.id));
  console.log(`  Need to search: ${toSearch.length} places`);

  const BATCH_SIZE = 50;
  let searched = 0;

  for (let i = 0; i < toSearch.length; i += BATCH_SIZE) {
    const batch = toSearch.slice(i, i + BATCH_SIZE);
    const promises = batch.map(async (place) => {
      try {
        const results = await retry(() => searchPlace(place.name, place.address), { retries: 1, delay: 2000 });
        const entry = { id: place.id, results };
        cache.set(place.id, entry);
        appendJsonl(cachePath, entry);
      } catch (err) {
        console.error(`  Search failed for ${place.id} (${place.name}): ${err.message}`);
        const entry = { id: place.id, results: [], error: err.message };
        cache.set(place.id, entry);
        appendJsonl(cachePath, entry);
      }
    });

    await Promise.all(promises);
    searched += batch.length;

    if (i + BATCH_SIZE < toSearch.length) {
      await sleep(100);
    }

    if (searched % 500 === 0 && searched > 0) {
      console.log(`  Searched: ${searched}/${toSearch.length}`);
    }
  }

  console.log(`  Search complete: ${searched} new, ${cache.size} total cached`);
  return cache;
}

async function searchPlace(name, address) {
  const res = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: {
      'X-API-KEY': SERPER_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ q: `"${name}" "${address}"`, num: 5 }),
  });

  if (!res.ok) {
    throw new Error(`Serper API ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
  return (data.organic || []).slice(0, 5).map(r => {
    let domain = '';
    try { domain = new URL(r.link).hostname; } catch { domain = r.link; }
    return {
      title: r.title,
      snippet: (r.snippet || '').slice(0, 160),
      domain,
      link: r.link,
    };
  });
}

// ── Stage 4: Website Extraction & Verification ──────────────────────────────

async function stage4WebsiteCheck(places, searchCache) {
  console.log('\n── Stage 4: Website Extraction & Verification ──');

  const results = new Map();
  const BATCH_SIZE = 50;
  let checked = 0;

  for (let i = 0; i < places.length; i += BATCH_SIZE) {
    const batch = places.slice(i, i + BATCH_SIZE);
    const promises = batch.map(async (place) => {
      const searchEntry = searchCache.get(place.id);
      const searchResults = searchEntry?.results || [];
      const ownedDomain = extractOwnedDomain(searchResults);

      let websiteResolves = false;
      if (ownedDomain) {
        try {
          const check = await verifyWebsite(ownedDomain.url);
          websiteResolves = check.resolves;
        } catch {
          websiteResolves = false;
        }
      }

      results.set(place.id, {
        searchResults,
        ownedDomain: ownedDomain ? { ...ownedDomain, resolves: websiteResolves } : null,
      });
    });

    await Promise.all(promises);
    checked += batch.length;

    if (checked % 1000 === 0 && checked > 0) {
      console.log(`  Website checked: ${checked}/${places.length}`);
    }
  }

  const withDomain = [...results.values()].filter(r => r.ownedDomain).length;
  const resolved = [...results.values()].filter(r => r.ownedDomain?.resolves).length;
  console.log(`  With owned domain: ${withDomain}`);
  console.log(`  Domain resolves: ${resolved}`);

  return results;
}

function extractOwnedDomain(results) {
  for (const r of results) {
    if (!SOCIAL_DOMAINS.some(s => r.domain.includes(s))) {
      return { domain: r.domain, url: r.link };
    }
  }
  return null;
}

async function verifyWebsite(url) {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      headers: { 'User-Agent': 'Mingla-Bot/1.0' },
      redirect: 'follow',
    });
    return { resolves: true, finalUrl: res.url, status: res.status };
  } catch {
    return { resolves: false };
  }
}

// ── Stage 5: GPT-5.4-mini Classification ────────────────────────────────────

async function stage5Classify(places, webResults, openai) {
  console.log('\n── Stage 5: GPT-5.4-mini Classification ──');

  const classified = [];
  const BATCH_SIZE = 25;
  const MAX_CONCURRENT = 10;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let processed = 0;

  for (let i = 0; i < places.length; i += BATCH_SIZE) {
    const batch = places.slice(i, i + BATCH_SIZE);

    // Process batch with concurrency limit
    for (let j = 0; j < batch.length; j += MAX_CONCURRENT) {
      const chunk = batch.slice(j, j + MAX_CONCURRENT);
      const promises = chunk.map(async (place) => {
        const web = webResults.get(place.id) || { searchResults: [], ownedDomain: null };
        const factSheet = buildFactSheet(place, web.searchResults, web.ownedDomain);

        try {
          const result = await retry(() => classifyPlace(openai, factSheet), { retries: 1, delay: 5000 });
          totalInputTokens += result._inputTokens || 0;
          totalOutputTokens += result._outputTokens || 0;
          return {
            ...place,
            _verdict: result.d,
            _reason: `Pipeline v1: ${result.r}`,
            _stage: 5,
            _categories: (result.d === 'accept' || result.d === 'reclassify') ? result.c : [],
            _primaryIdentity: result.pi,
            _confidence: result.f,
            _websiteVerified: result.w,
            _evidence: factSheet.evidence,
          };
        } catch (err) {
          console.error(`  GPT failed for ${place.id} (${place.name}): ${err.message}`);
          return {
            ...place,
            _verdict: 'error',
            _reason: `Pipeline v1: GPT classification failed — ${err.message}`,
            _stage: 5,
            _categories: place.ai_categories || [],
            _primaryIdentity: place.primary_type || 'unknown',
            _confidence: 'low',
            _error: err.message,
          };
        }
      });

      const chunkResults = await Promise.all(promises);
      classified.push(...chunkResults);
    }

    processed += batch.length;
    if (i + BATCH_SIZE < places.length) {
      await sleep(200);
    }

    if (processed % 1000 === 0 && processed > 0) {
      const costEstimate = (totalInputTokens * 0.00000015 + totalOutputTokens * 0.0000006).toFixed(4);
      console.log(`  Classified: ${processed}/${places.length} | Tokens in: ${totalInputTokens} out: ${totalOutputTokens} | Est cost: $${costEstimate}`);
    }
  }

  const costEstimate = (totalInputTokens * 0.00000015 + totalOutputTokens * 0.0000006).toFixed(4);
  console.log(`  Classification complete: ${classified.length} places`);
  console.log(`  Total tokens — in: ${totalInputTokens}, out: ${totalOutputTokens}`);
  console.log(`  Estimated GPT cost: $${costEstimate}`);

  return { classified, gptCost: parseFloat(costEstimate), totalInputTokens, totalOutputTokens };
}

function buildFactSheet(place, searchResults, ownedDomain) {
  return {
    name: place.name,
    type: place.primary_type,
    cats: place.ai_categories || [],
    price: place.price_level || 'unknown',
    rating: place.rating,
    reviews: place.review_count || 0,
    web: ownedDomain?.domain || null,
    hours: !!place.opening_hours,
    evidence: searchResults.slice(0, 3)
      .map(r => `${r.title}: ${r.snippet}`)
      .join(' | ')
      .slice(0, 650),
  };
}

async function classifyPlace(openai, factSheet) {
  const response = await openai.responses.create({
    model: 'gpt-4o',
    input: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: JSON.stringify(factSheet) },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'place_classification',
        schema: CLASSIFICATION_SCHEMA,
        strict: true,
      },
    },
  });

  const outputText = response.output?.find(o => o.type === 'message')
    ?.content?.find(c => c.type === 'output_text')?.text;

  if (!outputText) {
    throw new Error('No text output from GPT response');
  }

  const parsed = JSON.parse(outputText);
  return {
    ...parsed,
    _inputTokens: response.usage?.input_tokens || 0,
    _outputTokens: response.usage?.output_tokens || 0,
  };
}

// ── Stage 6: Write Results to Database ──────────────────────────────────────

async function stage6WriteDB(supabase, allResults, opts) {
  console.log('\n── Stage 6: Write Results to Database ──');

  if (opts.dryRun) {
    console.log('  Dry run — skipping DB writes');
    return { written: 0, errors: 0 };
  }

  const BATCH_SIZE = 50;
  let written = 0;
  let errors = 0;
  const failurePath = resolve(OUTPUTS_DIR, 'pipeline_failures.jsonl');

  for (let i = 0; i < allResults.length; i += BATCH_SIZE) {
    const batch = allResults.slice(i, i + BATCH_SIZE);
    const promises = batch.map(async (result) => {
      if (result._verdict === 'error') {
        appendJsonl(failurePath, { id: result.id, name: result.name, error: result._error });
        errors++;
        return;
      }

      const confidenceNum = result._confidence === 'high' ? 0.95
        : result._confidence === 'medium' ? 0.7 : 0.4;

      const update = {
        ai_approved: result._verdict === 'accept' || (result._verdict === 'reclassify' && result._categories?.length > 0),
        ai_categories: result._categories || [],
        ai_primary_identity: result._primaryIdentity || result.primary_type || 'unknown',
        ai_confidence: confidenceNum,
        ai_reason: result._reason,
        ai_web_evidence: (result._evidence || '').slice(0, 500),
        ai_validated_at: new Date().toISOString(),
      };

      try {
        const { error } = await retry(
          () => supabase.from('place_pool').update(update).eq('id', result.id),
          { retries: 1, delay: 2000 }
        );
        if (error) throw error;
        written++;
      } catch (err) {
        console.error(`  DB write failed for ${result.id}: ${err.message}`);
        appendJsonl(failurePath, { id: result.id, name: result.name, error: err.message });
        errors++;
      }
    });

    await Promise.all(promises);

    if ((i + BATCH_SIZE) % 2000 === 0 && i > 0) {
      console.log(`  Written: ${written}, Errors: ${errors}`);
    }
  }

  console.log(`  Write complete — written: ${written}, errors: ${errors}`);
  return { written, errors };
}

// ── Stage 7: Summary & Output ───────────────────────────────────────────────

function stage7Summary(allResults, stage2Results, gptStats, writeStats, opts) {
  console.log('\n── Stage 7: Summary & Output ──');

  // Write full JSONL results
  if (existsSync(opts.output)) {
    writeFileSync(opts.output, ''); // truncate
  }
  for (const r of allResults) {
    appendJsonl(opts.output, {
      id: r.id,
      name: r.name,
      decision: r._verdict,
      categories: r._categories,
      reason: r._reason,
      confidence: r._confidence || 'high',
      stage_resolved: r._stage,
    });
  }

  // Write low-confidence file
  const lowConfPath = resolve(OUTPUTS_DIR, 'pipeline_low_confidence.jsonl');
  if (existsSync(lowConfPath)) writeFileSync(lowConfPath, '');
  const lowConf = allResults.filter(r => r._confidence === 'low');
  for (const r of lowConf) {
    appendJsonl(lowConfPath, {
      id: r.id,
      name: r.name,
      address: r.address,
      categories: r._categories,
      reason: r._reason,
    });
  }

  // Summary stats
  const accepted = allResults.filter(r => r._verdict === 'accept').length;
  const reclassified = allResults.filter(r => r._verdict === 'reclassify').length;
  const rejected = allResults.filter(r => r._verdict === 'reject').length;
  const errored = allResults.filter(r => r._verdict === 'error').length;
  const stage5Count = allResults.filter(r => r._stage === 5).length;
  const stage5Accepted = allResults.filter(r => r._stage === 5 && r._verdict === 'accept').length;
  const stage5Reclassified = allResults.filter(r => r._stage === 5 && r._verdict === 'reclassify').length;
  const stage5Rejected = allResults.filter(r => r._stage === 5 && r._verdict === 'reject').length;

  const summary = `
Pipeline Complete
=================
Total processed: ${allResults.length.toLocaleString()}
Stage 2 (deterministic): ${stage2Results.rejected.length} rejected, ${stage2Results.downgraded.length} downgraded, ${stage2Results.upscaled.length} upscaled
Stage 5 (GPT classified): ${stage5Count.toLocaleString()}
  - Accepted: ${stage5Accepted.toLocaleString()}
  - Reclassified: ${stage5Reclassified.toLocaleString()}
  - Rejected: ${stage5Rejected.toLocaleString()}
  - Low confidence (needs review): ${lowConf.length.toLocaleString()}
  - Errors: ${errored}

Final accepted: ${(accepted + reclassified).toLocaleString()}
Final reclassified: ${reclassified.toLocaleString()}
Final rejected: ${rejected.toLocaleString()}
Estimated GPT cost: $${gptStats.gptCost.toFixed(2)}
DB writes: ${writeStats.written} successful, ${writeStats.errors} failed
${opts.dryRun ? '\n⚠ DRY RUN — no database changes were made' : ''}

Results written to: ${opts.output}
Low confidence: ${lowConfPath} (${lowConf.length} places)
`;

  console.log(summary);
  return summary;
}

// ── Main Pipeline ────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();
  requireEnv();

  if (!existsSync(OUTPUTS_DIR)) mkdirSync(OUTPUTS_DIR, { recursive: true });

  console.log('Mingla Place Verification Pipeline v1');
  console.log('=====================================');
  if (opts.dryRun) console.log('MODE: DRY RUN (no DB writes)');
  if (opts.limit) console.log(`LIMIT: ${opts.limit} places`);
  if (opts.category) console.log(`CATEGORY: ${opts.category}`);
  if (opts.country) console.log(`COUNTRY: ${opts.country}`);
  if (opts.city) console.log(`CITY: ${opts.city}`);

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

  // Checkpoint/resume
  const checkpointPath = resolve(OUTPUTS_DIR, 'pipeline_checkpoint.json');
  let resumeFromId = null;
  if (opts.resume) {
    const cp = loadCheckpoint(checkpointPath);
    if (cp) {
      resumeFromId = cp.lastProcessedId;
      console.log(`Resuming from checkpoint: ${resumeFromId}`);
    } else {
      console.log('No checkpoint found, starting from beginning');
    }
  }

  // Stage 1: Export
  let places = await stage1Export(supabase, opts);

  // Apply resume filter
  if (resumeFromId) {
    const idx = places.findIndex(p => p.id === resumeFromId);
    if (idx >= 0) {
      places = places.slice(idx + 1);
      console.log(`  Resumed: skipped ${idx + 1} places, ${places.length} remaining`);
    }
  }

  // Stage 2: Pre-filter
  const stage2 = stage2PreFilter(places);

  // Stage 3: Search
  const searchCache = await stage3Search(stage2.passed, opts);

  // Stage 4: Website check
  const webResults = await stage4WebsiteCheck(stage2.passed, searchCache);

  // Stage 5: Classify
  const { classified, gptCost, totalInputTokens, totalOutputTokens } =
    await stage5Classify(stage2.passed, webResults, openai);

  // Combine all results
  const allResults = [
    ...stage2.rejected,
    ...stage2.downgraded,
    ...stage2.upscaled,
    ...classified,
  ];

  // Stage 6: Write to DB
  const writeStats = await stage6WriteDB(supabase, allResults, opts);

  // Save checkpoint
  if (allResults.length > 0) {
    const lastId = allResults[allResults.length - 1].id;
    saveCheckpoint(checkpointPath, {
      lastProcessedId: lastId,
      timestamp: new Date().toISOString(),
      totalProcessed: allResults.length,
    });
  }

  // Stage 7: Summary
  stage7Summary(allResults, stage2, { gptCost, totalInputTokens, totalOutputTokens }, writeStats, opts);
}

main().catch(err => {
  console.error('\nPipeline fatal error:', err.message);
  console.error(err.stack);
  process.exit(1);
});

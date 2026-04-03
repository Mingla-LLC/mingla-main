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
  kids: ["kids play","children's","indoor playground","kidz","chuck e. cheese","kidzone","enfants","kinder","bambini","infantil","splash pad","soft play"],
  utilitarian: ["gas station","car wash","laundromat","storage unit","parking garage","auto repair","car dealership"],
  delivery: ["ghost kitchen","delivery only","cloud kitchen","virtual kitchen"],
  food_truck: ["food truck","food cart","mobile kitchen"],
  not_venue: ["real estate","insurance","accounting","law firm","consulting","contractor","plumber","electrician","production company","booking agency","talent agency","event management"],
  gambling: ["spielhalle","betting shop","slot machine","gambling hall"],
  allotment: ["kleingartenanlage","kleingarten","kolonie","schrebergarten","allotment garden","jardin partagé","community garden","volkstuinen"],
};

const CASUAL_CHAIN_DEMOTION = [
  "olive garden","red lobster","outback","cheesecake factory","applebee","chili's","tgi friday","denny's","ihop","waffle house","cracker barrel","texas roadhouse","red robin","buffalo wild wings","longhorn steakhouse","nando's","wagamama","yo! sushi","pizza express","pizzaexpress","hippopotamus",
];

const SOCIAL_DOMAINS = [
  "google.com","maps.google.com","facebook.com","instagram.com","twitter.com","x.com","yelp.com","tripadvisor.com","foursquare.com","youtube.com","tiktok.com","linkedin.com","pinterest.com","fresha.com","treatwell.com","treatwell.co.uk","treatwell.de","groupon.com","booksy.com","planity.com","vagaro.com","classpass.com","mindbody.com","wikipedia.org","wikidata.org","yellowpages.com","yell.com","pagesjaunes.fr","dasoertliche.de",
];

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

async function withRetry<T>(fn: () => Promise<T>, retries = 1, delay = 3000): Promise<T> {
  try { return await fn(); }
  catch (err) {
    const msg = (err as Error).message || "";
    if (retries <= 0 || msg.includes("429") || msg.includes("quota") || msg.includes("exceeded")) throw err;
    await sleep(delay);
    return withRetry(fn, retries - 1, delay);
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
  verdict: "reject" | "accept" | "pass";
  reason?: string;
  categories?: string[];
  stageResolved?: number;
}

function deterministicFilter(place: any): PreFilterResult {
  const name = place.name || "";
  const primaryType = place.primary_type || "";
  const checkText = `${name} ${primaryType}`.toLowerCase();

  if (nameMatches(name, FAST_FOOD_BLACKLIST)) {
    return { verdict: "reject", reason: "Pipeline: fast food chain — rejected", categories: [], stageResolved: 2 };
  }

  for (const [category, keywords] of Object.entries(EXCLUSION_KEYWORDS)) {
    if (keywords.some((kw) => checkText.includes(kw.toLowerCase()))) {
      return { verdict: "reject", reason: `Pipeline: excluded type (${category}) — rejected`, categories: [], stageResolved: 2 };
    }
  }

  if (nameMatches(name, CASUAL_CHAIN_DEMOTION)) {
    const cats = [...(place.ai_categories || [])];
    if (cats.includes("fine_dining")) {
      const newCats = cats.filter((c: string) => c !== "fine_dining");
      if (!newCats.includes("casual_eats")) newCats.push("casual_eats");
      return { verdict: "accept", reason: "Pipeline: sit-down chain — downgraded from fine_dining to casual_eats", categories: newCats, stageResolved: 2 };
    }
  }

  return { verdict: "pass" };
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
      decision: preFilter.verdict,
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
    console.error(`GPT failed for ${place.id}: ${(err as Error).message}`);
    return {
      decision: "accept",
      categories: place.ai_categories || [],
      primary_identity: place.primary_type || "unknown",
      confidence: "low",
      reason: `Pipeline v1: GPT classification failed — ${(err as Error).message}`,
      evidence: factSheet.evidence.slice(0, 500),
      stage_resolved: 5,
      website_verified: false,
      search_results: searchResults,
      cost_usd: serperCost,
    };
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
  const { data, error } = await db.rpc("admin_ai_validation_preview", {
    p_scope: body.scope || "unvalidated",
    p_category: body.category || null,
    p_country: body.country || null,
    p_city: body.city || null,
    p_revalidate: body.revalidate || false,
  });
  if (error) return json({ error: error.message }, 500);
  return json(data);
}

async function handleCreateRun(body: any, userId: string): Promise<Response> {
  const db = getDb();

  // Check for existing active run
  const { data: activeRun } = await db
    .from("ai_validation_jobs")
    .select("id")
    .in("status", ["ready", "running", "paused"])
    .limit(1)
    .maybeSingle();
  if (activeRun) return json({ status: "already_active", run_id: activeRun.id });

  const scope = body.scope || "unvalidated";
  const batchSize = Math.min(body.batch_size || 25, 50);

  // Get place count for cost estimate
  const { data: previewData } = await db.rpc("admin_ai_validation_preview", {
    p_scope: scope,
    p_category: body.category || null,
    p_country: body.country || null,
    p_city: body.city || null,
    p_revalidate: body.revalidate || false,
  });

  const estimatedCost = previewData?.estimated_cost_usd || 0;
  const placeCount = previewData?.places_to_process || 0;

  if (placeCount === 0) return json({ status: "nothing_to_do", total_places: 0 });

  // Query matching places
  let query = db
    .from("place_pool")
    .select("id")
    .eq("is_active", true)
    .order("created_at", { ascending: true });

  if (scope === "unvalidated" && !body.revalidate) {
    query = query.is("ai_validated_at", null);
  }
  if (body.category) {
    query = query.contains("ai_categories", [body.category]);
  }
  if (body.country) {
    query = query.ilike("country", `%${body.country}%`);
  }
  if (body.city) {
    query = query.ilike("city", `%${body.city}%`);
  }

  // Fetch all IDs (paginated)
  const allIds: string[] = [];
  let from = 0;
  const pageSize = 1000;
  while (true) {
    const { data: page, error: pageErr } = await query.range(from, from + pageSize - 1);
    if (pageErr) return json({ error: pageErr.message }, 500);
    allIds.push(...(page || []).map((p: any) => p.id));
    if (!page || page.length < pageSize) break;
    from += pageSize;
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
      estimated_cost_usd: estimatedCost,
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
    estimated_cost_usd: estimatedCost,
  });
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
  const { data, error } = await db.rpc("admin_ai_run_status", { p_job_id: body.run_id });
  if (error) return json({ error: error.message }, 500);
  return json(data);
}

async function handleGetResults(body: any): Promise<Response> {
  const db = getDb();
  const { data, error } = await db.rpc("admin_ai_run_results", {
    p_job_id: body.job_id || null,
    p_decision: body.decision || null,
    p_category: body.category || null,
    p_confidence: body.confidence || null,
    p_search: body.search || null,
    p_page: body.page || 1,
    p_page_size: body.page_size || 50,
  });
  if (error) return json({ error: error.message }, 500);
  return json(data);
}

async function handleReviewQueue(body: any): Promise<Response> {
  const db = getDb();
  const { data, error } = await db.rpc("admin_ai_review_queue", {
    p_job_id: body.job_id || null,
    p_filter: body.filter || "all",
    p_page: body.page || 1,
    p_page_size: body.page_size || 20,
  });
  if (error) return json({ error: error.message }, 500);
  return json(data);
}

async function handleOverride(body: any): Promise<Response> {
  const db = getDb();
  const { data, error } = await db.rpc("admin_ai_override_place", {
    p_result_id: body.result_id,
    p_decision: body.decision,
    p_categories: body.categories || null,
    p_reason: body.reason || null,
  });
  if (error) return json({ error: error.message }, 500);
  return json(data);
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
      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (err) {
    console.error("ai-verify-pipeline error:", err);
    return json({ error: (err as Error).message || "Internal error" }, 500);
  }
});

import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ── Category Criteria ───────────────────────────────────────────────────────
// Identical to ai-validate-cards — same rubrics, same categories.

const CATEGORY_CRITERIA: Record<string, string> = {
  flowers: `The user wants to buy flowers for a date.
The place must be somewhere you can walk in and purchase fresh-cut flowers or arrangements.
YES: dedicated florists, flower bars, boutique flower shops, flower studios, grocery stores
that are KNOWN to have a real flower section with decent bouquets (e.g., Trader Joe's,
Whole Foods, large supermarkets with staffed floral departments).
NO: grocery stores where flowers are an afterthought (tiny wilted section by the exit),
farmers markets (unpredictable availability), garden centers that only sell potted plants,
convenience stores, gas stations.
The test: "Can I reliably walk in and leave with a nice, date-worthy bouquet?"
When in doubt, search the web for this specific location — check if they have a floral
department or flower offerings.`,

  fine_dining: `The user wants a special-occasion dinner that feels like an event.
YES: tasting menus, sommelier service, $50+ entrees, reservations expected or required,
Michelin-starred or Michelin-level quality, acclaimed chef-driven restaurants.
NO: chain restaurants (Outback, Olive Garden, Red Lobster, Cheesecake Factory, etc.),
casual restaurants with slightly high prices, diners, buffets, fast-casual, any place
where you'd comfortably wear jeans and sneakers.
The test: "Would I take someone here to celebrate an anniversary or truly impress a date?"
Price level MODERATE or below is almost certainly NOT fine dining. Search for the restaurant
online — check menus, reviews, dress code, ambiance.`,

  nature_views: `The user wants to be outdoors in a beautiful, scenic setting.
YES: scenic parks, botanical gardens, beaches, hiking trails, observation decks, waterfront
promenades, gardens, nature preserves, scenic overlooks, rooftop venues with panoramic views.
NO: parking lots with a view, sports facilities (batting cages, basketball courts, fields),
dog parks, office parks with some grass, strip mall plazas, gas stations near highways.
The test: "Would a couple enjoy a leisurely walk here and feel like they escaped the city?"`,

  first_meet: `The user wants a casual, low-pressure place for a first meeting.
YES: cozy cafés, coffee shops, tea houses, bookstore cafés, bakeries with seating, casual
dessert spots, ice cream parlors, quiet wine bars, bookstores.
NO: loud bars, nightclubs, fine dining (too formal/expensive), fast food chains,
drive-throughs, gas station coffee, places with no seating.
The test: "Could two people who just met sit here for 45 minutes and have a comfortable
conversation?"`,

  drink: `The user wants to go out for drinks in a social setting.
YES: bars, cocktail bars, wine bars, breweries, beer gardens, pubs, speakeasies, rooftop
bars, craft coffee roasteries with ambiance, upscale tea houses.
NO: restaurants where drinks are secondary to food, nightclubs where you can't hear each
other, liquor stores (retail), gas station drink counters, fast food drink options.
The test: "Is the primary draw of this place the drinks and the social atmosphere?"`,

  casual_eats: `The user wants a good meal in a relaxed, everyday setting.
YES: restaurants (any cuisine), bistros, brunch spots, diners, pizzerias, taco joints,
sushi bars, noodle shops, food halls, cafés with real food menus.
NO: fast food drive-throughs (McDonald's, Wendy's, Taco Bell), gas station food, grocery
store delis, vending machines, catering companies, ghost kitchens with no dine-in.
The test: "Would you say 'let's grab dinner here' without needing a special occasion?"`,

  watch: `The user wants to watch a movie or screening.
YES: movie theaters, indie cinemas, drive-in theaters, IMAX theaters, film screening venues.
NO: bars with TVs, home theater stores, museums with short film exhibits, sports stadiums.
The test: "Can you sit down and watch a full-length movie or screening here?"`,

  live_performance: `The user wants to see a live show — music, theater, comedy, opera, dance.
YES: concert halls, theaters, opera houses, comedy clubs, live music venues, amphitheaters,
jazz clubs, cabaret venues, venues with regular scheduled performances.
NO: bars that occasionally have a musician (background music), karaoke (user performs, not
watches), busking/street performance spots.
The test: "Is there a stage, scheduled performers, and a seated/standing audience?"`,

  creative_arts: `The user wants a cultural or artistic experience.
YES: art galleries, museums, art studios (paint-and-sip, pottery), history museums, cultural
centers, sculpture parks, photography exhibits, immersive art experiences.
NO: art supply stores, framing shops, printing services, craft stores (Michael's, Joann),
retail stores selling art prints.
The test: "Will the user experience, view, or create art here?"`,

  play: `The user wants active fun — games, physical activity, competition, thrills.
YES: bowling alleys, arcades, mini golf, go-karts, laser tag, trampoline parks, escape rooms,
amusement parks, karaoke, paintball, ice skating, rock climbing gyms, axe throwing.
NO: regular gyms/fitness centers, organized sports leagues, playgrounds designed for children,
retail game/toy stores, video game stores.
The test: "Will the user be actively playing, competing, or having physical fun on this date?"`,

  wellness: `The user wants relaxation and self-care — a spa day, massage, or calming experience.
YES: day spas, massage studios, hot springs, float tanks, saunas, hammams, resort spa
experiences, meditation centers, wellness retreats.
NO: gyms, fitness centers, yoga-only studios (unless they also offer spa services), medical
clinics, chiropractors, physical therapy offices, dermatologists.
The test: "Will the user leave feeling pampered and deeply relaxed?"`,

  picnic_park: `The user wants a place specifically suited for having a picnic.
YES: parks with open lawns, designated picnic grounds, waterfront parks with grassy areas,
botanical gardens with picnic-friendly spaces, any park where you can comfortably lay a blanket.
NO: sports fields (in use), dog parks (chaotic), playgrounds (loud/crowded), parking lots,
indoor venues, parks that are essentially concrete plazas.
The test: "Can you lay a blanket on the grass, open a bottle of wine, and enjoy a meal?"`,

  groceries: `The user needs to buy groceries — for picnic supplies or cooking.
YES: grocery stores, supermarkets, specialty food stores (cheese shops, delis), gourmet markets,
organic markets.
NO: convenience stores (too limited selection), gas stations, vending machines, restaurants,
pure bakeries (too narrow).
The test: "Can you buy a variety of ingredients to prepare a meal or assemble a picnic here?"`,
};

// ── Validation Response Schema ──────────────────────────────────────────────

const VALIDATION_RESPONSE_SCHEMA = {
  type: "object" as const,
  properties: {
    primary_identity: {
      type: "string" as const,
      description:
        "What this place fundamentally IS in 1-3 words (e.g., 'Italian restaurant', 'art museum', 'cocktail bar', 'children\\'s play center', 'gym'). This is NOT a Mingla category — it is your honest assessment of the place's core identity.",
    },
    dominated_category: {
      type: ["string", "null"] as const,
      description:
        "The single BEST Mingla category slug for this place, or null if it fits none. Must be one of the provided category slugs.",
    },
    fits_categories: {
      type: "array" as const,
      items: { type: "string" as const },
      description:
        "ALL Mingla category slugs this place genuinely fits as a CORE function. Can be empty. Only include categories where the match is obvious and undeniable.",
    },
    confidence: {
      type: "number" as const,
      description:
        "How confident you are in this classification from 0.0 to 1.0. Below 0.7 means you are unsure and this should be flagged for human review.",
    },
    reason: {
      type: "string" as const,
      description:
        "Your reasoning: state the primary identity, then for each category you considered explain why you included or excluded it.",
    },
    web_evidence: {
      type: "string" as const,
      description:
        "Brief summary of what you found when searching for this place online — website info, reviews, photos, what the place actually offers.",
    },
  },
  required: [
    "primary_identity",
    "dominated_category",
    "fits_categories",
    "confidence",
    "reason",
    "web_evidence",
  ],
  additionalProperties: false,
};

// ── Types ───────────────────────────────────────────────────────────────────

interface PlaceRow {
  place_id: string;
  name: string;
  primary_type: string | null;
  types: string[];
  rating: number | null;
  review_count: number;
  price_level: string | null;
  website: string | null;
  address: string | null;
  editorial_summary: string | null;
  google_summary: string | null;
  seeding_category: string | null;
}

interface ValidationResult {
  primary_identity: string;
  dominated_category: string | null;
  fits_categories: string[];
  confidence: number;
  reason: string;
  web_evidence: string;
}

interface RequestBody {
  categorySlug?: string;
  placeIds?: string[];
  revalidate?: boolean;
  limit?: number;
  dryRun?: boolean;
  afterCreatedAt?: string;
  countryFilter?: string;
  cityFilter?: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function buildPrompt(place: PlaceRow): string {
  const categoryCriteria = Object.entries(CATEGORY_CRITERIA)
    .map(([slug, criteria]) => `**${slug}**: ${criteria}`)
    .join("\n\n");

  return `You are a strict quality gatekeeper for Mingla, a dating and experiences app.
Your job: determine which categories a real-world place belongs to. Your DEFAULT answer
is that a place fits ZERO categories. You only add a category when the match is OBVIOUS
and UNDENIABLE.

CRITICAL RULES:
- First, determine what this place PRIMARILY IS (its core identity: restaurant, museum,
  bar, park, theater, etc.). This is the lens through which you judge everything.
- A place's PRIMARY IDENTITY must match a category's core purpose to qualify.
  A museum is NOT "casual_eats" just because it has a café inside.
  A park is NOT "drink" just because there's a nearby kiosk.
  A hotel is NOT "wellness" just because it has a pool.
- Only add a SECONDARY category when that function is a MAJOR, ADVERTISED part of the
  business — not a side feature, not an afterthought, not something you might find if you
  look hard enough.
- When in doubt, EXCLUDE the category. A false positive (wrong category) is far worse
  than a false negative (missing category). Users lose trust when they see irrelevant places.

IMPORTANT: Use web search to research this place. Look up the business name and location.
Check their website, read reviews, look at photos, verify what they actually offer.
Do NOT rely solely on the data below — verify it against real-world information.

PLACE DATA (from Google):
- Name: ${place.name}
- Address: ${place.address}
- Google primary type: ${place.primary_type}
- All Google types: ${(place.types || []).join(", ")}
- Rating: ${place.rating}★ (${place.review_count} reviews)
- Price level: ${place.price_level || "unknown"}
- Website: ${place.website || "none"}
- Google says: "${place.google_summary || place.editorial_summary || "no description available"}"

AVAILABLE MINGLA CATEGORIES AND WHAT THEY MEAN:

${categoryCriteria}

WORKED EXAMPLES (learn the reasoning pattern):

Example 1: "The Metropolitan Museum of Art" — primary identity: MUSEUM
- creative_arts: YES — it is literally an art museum, this is its core purpose
- casual_eats: NO — it has a cafeteria inside, but nobody goes to the Met to eat. Reject.
- first_meet: NO — you could meet someone here, but it's not a café/low-pressure spot. Reject.
- Result: fits_categories: ["creative_arts"], dominated_category: "creative_arts"

Example 2: "The Rooftop at Pier 17" — primary identity: ROOFTOP BAR/VENUE
- drink: YES — it is a bar, drinks are a core offering
- nature_views: YES — it is a rooftop with panoramic skyline/waterfront views, this is a major draw
- live_performance: YES — it hosts regular scheduled concerts as a major part of its identity
- casual_eats: NO — it serves food, but people go for drinks/views/shows, not the food. Reject.
- Result: fits_categories: ["drink", "nature_views", "live_performance"], dominated_category: "drink"

Example 3: "Whole Foods Market" — primary identity: GROCERY STORE
- groceries: YES — it is literally a grocery store
- flowers: YES — Whole Foods is KNOWN for having a large, staffed floral department with quality bouquets
- casual_eats: NO — it has a hot bar, but it's a grocery store, not a restaurant. Reject.
- Result: fits_categories: ["groceries", "flowers"], dominated_category: "groceries"

Example 4: "Planet Fitness" — primary identity: GYM
- play: NO — it's a gym, not a fun/recreational activity venue. Reject.
- wellness: NO — it's a fitness center, not a spa. Reject.
- Result: fits_categories: [], dominated_category: null

Example 5: "Brooklyn Flea & Smorgasburg" — primary identity: FARMERS MARKET / FLEA MARKET
- casual_eats: NO — there are food vendors, but availability is seasonal/unpredictable and it's not a restaurant. Reject.
- groceries: NO — you might find produce, but it's not a grocery store. Reject.
- flowers: NO — a vendor might sell flowers one week and not the next. Unreliable. Reject.
- creative_arts: NO — there are craft vendors, but it's a market, not a gallery or art experience. Reject.
- Result: fits_categories: [], dominated_category: null

Example 6: "KidZania" — primary identity: CHILDREN'S ENTERTAINMENT CENTER
- play: NO — it's designed for kids, not for an adult date. Reject.
- creative_arts: NO — kid-focused activities, not an adult cultural experience. Reject.
- Result: fits_categories: [], dominated_category: null

AUTOMATIC REJECTIONS — these place types NEVER fit any Mingla category:

1. KIDS-ORIENTED: children's museums, kids' play centers, children's theaters, kiddie
   amusement parks, indoor playgrounds, kid-focused trampoline parks, baby gyms, etc.
   Test: "Would two adults on a date feel out of place here without children?" If yes → reject all.

2. RELIGIOUS INSTITUTIONS: churches, mosques, temples, synagogues, religious centers.
   Exception: if the place is primarily a TOURIST LANDMARK (e.g., Sagrada Família, Notre-Dame)
   it may qualify for creative_arts. But a regular neighborhood church → reject all.

3. MEDICAL / HEALTHCARE: hospitals, clinics, dentists, urgent care, pharmacies, physical
   therapy offices, chiropractors, optometrists, veterinary clinics.

4. GOVERNMENT / CIVIC: DMVs, courthouses, post offices, police stations, fire stations,
   tax offices, embassies (unless a historic landmark open to tourists).

5. EDUCATION: schools, daycares, tutoring centers. Exception: university campus venues that
   are open to the public (e.g., a campus art gallery or public lecture hall) may qualify on
   their own merits — judge the specific venue, not the university.

6. UTILITARIAN: gas stations, car washes, laundromats, storage facilities, parking garages,
   auto repair shops, hardware stores, office supply stores, banks, ATMs.

7. FARMERS MARKETS / FLEA MARKETS / POP-UPS: seasonal, unpredictable availability. A user
   could show up and find nothing. Reject all unless it is a PERMANENT, year-round market
   with reliable vendors.

YOUR TASK:
1. Search the web for "${place.name}" near "${place.address}" to understand what this place ACTUALLY is.
2. State the place's PRIMARY IDENTITY in one word (restaurant, museum, bar, park, etc.).
3. Go through EACH Mingla category and ask: "Is this a CORE function of this place?"
   - If YES and it's obvious → include it
   - If MAYBE or you have to stretch → EXCLUDE it
4. Pick the single BEST category (or null if none fit).

Respond with JSON only.`;
}

async function callGPT(
  prompt: string,
  apiKey: string
): Promise<ValidationResult> {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      tools: [{ type: "web_search_preview" }],
      input: prompt,
      text: {
        format: {
          type: "json_schema",
          name: "place_validation",
          schema: VALIDATION_RESPONSE_SCHEMA,
          strict: true,
        },
      },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenAI API error ${response.status}: ${errText}`);
  }

  const data = await response.json();

  let jsonText: string | null = null;
  for (const item of data.output || []) {
    if (item.type === "message") {
      for (const content of item.content || []) {
        if (content.type === "output_text") {
          jsonText = content.text;
          break;
        }
      }
      if (jsonText) break;
    }
  }

  if (!jsonText) {
    throw new Error("No text output found in Responses API result");
  }

  const parsed = JSON.parse(jsonText) as ValidationResult;

  // Validate fits_categories contains only known slugs
  const validSlugs = Object.keys(CATEGORY_CRITERIA);
  parsed.fits_categories = parsed.fits_categories.filter((s) =>
    validSlugs.includes(s)
  );
  if (
    parsed.dominated_category &&
    !validSlugs.includes(parsed.dominated_category)
  ) {
    parsed.dominated_category = parsed.fits_categories[0] || null;
  }

  return parsed;
}

// ── Main Handler ────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth: require service_role key or admin JWT
    const authHeader = req.headers.get("authorization") ?? "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const openaiApiKey = Deno.env.get("OPENAI_API_KEY");

    if (!openaiApiKey) {
      return new Response(
        JSON.stringify({ error: "OpenAI API key not configured" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    // Verify caller is admin
    const token = authHeader.replace("Bearer ", "");
    if (token !== serviceRoleKey) {
      const {
        data: { user },
        error: authError,
      } = await supabaseAdmin.auth.getUser(token);
      if (authError || !user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: adminUser } = await supabaseAdmin
        .from("admin_users")
        .select("id")
        .eq("email", user.email?.toLowerCase())
        .eq("status", "active")
        .single();
      if (!adminUser) {
        return new Response(JSON.stringify({ error: "Forbidden: not admin" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const body: RequestBody = await req.json();
    const {
      categorySlug,
      placeIds,
      revalidate = false,
      limit: rawLimit = 25,
      dryRun = false,
      afterCreatedAt,
      countryFilter,
      cityFilter,
    } = body;

    const limit = Math.min(Math.max(rawLimit, 1), 100);

    // ── Query place_pool directly ────────────────────────────────────────────

    let query = supabaseAdmin
      .from("place_pool")
      .select(
        "id, name, address, primary_type, types, rating, review_count, price_level, website, editorial_summary, raw_google_data, seeding_category, ai_approved, ai_categories, created_at"
      )
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (!revalidate) {
      query = query.is("ai_approved", null);
    }
    if (categorySlug) {
      query = query.eq("seeding_category", categorySlug);
    }
    if (placeIds && placeIds.length > 0) {
      query = query.in("id", placeIds);
    }
    if (countryFilter) {
      query = query.eq("country", countryFilter);
    }
    if (cityFilter) {
      query = query.eq("city", cityFilter);
    }
    if (afterCreatedAt) {
      query = query.lt("created_at", afterCreatedAt);
    }

    const { data: places, error: fetchError } = await query;

    if (fetchError) {
      return new Response(
        JSON.stringify({ error: `Fetch failed: ${fetchError.message}` }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!places || places.length === 0) {
      return new Response(
        JSON.stringify({
          processed: 0,
          approved: 0,
          rejected: 0,
          failed: 0,
          rejectedExamples: [],
          recategorizedExamples: [],
          costUsd: 0,
          continuation_token: null,
          dryRun,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // ── Validate each place sequentially ──────────────────────────────────────

    let approved = 0;
    let rejected = 0;
    let failed = 0;
    const rejectedExamples: Array<{
      name: string;
      originalCategory: string;
      reason: string;
    }> = [];
    const recategorizedExamples: Array<{
      name: string;
      from: string;
      to: string[];
      reason: string;
    }> = [];
    let lastProcessedCreatedAt: string | null = null;

    for (const place of places) {
      const placeRow: PlaceRow = {
        place_id: place.id,
        name: place.name,
        primary_type: place.primary_type,
        types: place.types || [],
        rating: place.rating,
        review_count: place.review_count || 0,
        price_level: place.price_level,
        website: place.website,
        address: place.address,
        editorial_summary: place.editorial_summary,
        google_summary:
          place.raw_google_data?.editorialSummary?.text ?? null,
        seeding_category: place.seeding_category,
      };

      let result: ValidationResult;
      try {
        const prompt = buildPrompt(placeRow);
        result = await callGPT(prompt, openaiApiKey);
      } catch (err) {
        console.error(
          `AI validation failed for place ${place.id} (${placeRow.name}):`,
          err
        );
        failed++;
        if (!dryRun) {
          await supabaseAdmin
            .from("place_pool")
            .update({
              ai_reason: `AI validation failed: ${(err as Error).message}`,
              ai_validated_at: new Date().toISOString(),
            })
            .eq("id", place.id);
        }
        lastProcessedCreatedAt = place.created_at;
        continue;
      }

      const fitsAny = result.fits_categories.length > 0;

      if (fitsAny) {
        approved++;
      } else {
        rejected++;
        rejectedExamples.push({
          name: placeRow.name,
          originalCategory: place.seeding_category || "none",
          reason: result.reason,
        });
      }

      // Track recategorization (seeding_category vs AI category)
      if (
        fitsAny &&
        place.seeding_category &&
        !result.fits_categories.includes(place.seeding_category)
      ) {
        recategorizedExamples.push({
          name: placeRow.name,
          from: place.seeding_category,
          to: result.fits_categories,
          reason: result.reason,
        });
      }

      // ── Write-back to place_pool ─────────────────────────────────────────
      if (!dryRun) {
        await supabaseAdmin
          .from("place_pool")
          .update({
            ai_approved: fitsAny,
            ai_primary_identity: result.primary_identity,
            ai_confidence: result.confidence,
            ai_reason: result.reason,
            ai_web_evidence: result.web_evidence,
            ai_categories: result.fits_categories,
            ai_validated_at: new Date().toISOString(),
          })
          .eq("id", place.id);
      }

      lastProcessedCreatedAt = place.created_at;
      console.log(
        `Validated place: ${placeRow.name} → ${fitsAny ? "approved" : "rejected"} [${result.fits_categories.join(", ")}]`
      );
    }

    // ── Return summary ─────────────────────────────────────────────────────

    const processed = approved + rejected + failed;
    const costUsd = Math.round(processed * 0.005 * 100) / 100;

    return new Response(
      JSON.stringify({
        processed,
        approved,
        rejected,
        failed,
        rejectedExamples: rejectedExamples.slice(0, 10),
        recategorizedExamples: recategorizedExamples.slice(0, 10),
        costUsd,
        continuation_token: lastProcessedCreatedAt,
        dryRun,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("ai-validate-places error:", error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

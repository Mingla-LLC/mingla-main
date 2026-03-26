import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ── Category Criteria ───────────────────────────────────────────────────────

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
    dominated_category: {
      type: ["string", "null"] as const,
      description:
        "The single BEST Mingla category for this place, or null if it fits none",
    },
    fits_categories: {
      type: "array" as const,
      items: { type: "string" as const },
      description:
        "ALL Mingla category slugs this place genuinely fits. Can be empty.",
    },
    reason: {
      type: "string" as const,
      description:
        "One sentence explaining why it fits these categories (or why it fits none)",
    },
    web_evidence: {
      type: "string" as const,
      description:
        "Brief summary of what you found when searching for this place online",
    },
  },
  required: [
    "dominated_category",
    "fits_categories",
    "reason",
    "web_evidence",
  ],
  additionalProperties: false,
};

// ── Types ───────────────────────────────────────────────────────────────────

interface CardRow {
  card_id: string;
  categories: string[];
  original_categories: string[] | null;
  card_type: string;
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
}

interface ValidationResult {
  dominated_category: string | null;
  fits_categories: string[];
  reason: string;
  web_evidence: string;
}

interface RequestBody {
  cardType?: "single" | "curated"; // default: 'single'
  categorySlug?: string;
  cardIds?: string[];
  revalidate?: boolean;
  limit?: number;
  dryRun?: boolean;
  afterCreatedAt?: string; // continuation token (ISO timestamp)
}

interface CuratedStopRow {
  card_id: string;
  stop_number: number;
  role: string | null;
  optional: boolean;
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
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function buildPrompt(place: CardRow): string {
  const categoryCriteria = Object.entries(CATEGORY_CRITERIA)
    .map(([slug, criteria]) => `**${slug}**: ${criteria}`)
    .join("\n\n");

  return `You are a quality judge for Mingla, a dating and experiences app.
Your job: determine which categories a real-world place GENUINELY belongs to.

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
- Currently assigned to: ${(place.categories || []).join(", ")}

AVAILABLE MINGLA CATEGORIES AND WHAT THEY MEAN:

${categoryCriteria}

YOUR TASK:
1. Search the web for "${place.name}" near "${place.address}" to understand what this place ACTUALLY is.
2. Based on your research, determine which Mingla categories this place GENUINELY fits.
   - A place can fit MULTIPLE categories (e.g., a rooftop bar with views fits "drink" AND "nature_views")
   - A place can fit just ONE category
   - A place can fit NO categories (if it's not suitable for any dating/experience context)
3. Pick the single BEST category for this place (its dominant use case for a date).

Be strict but fair. The goal is: if a user sees this place under a category, they should feel
HAPPY about the suggestion, not confused or disappointed.

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
      model: "gpt-5.4-mini",
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

  // Responses API: find the message output item and extract text
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

// ── Curated Card Validation ──────────────────────────────────────────────────

// deno-lint-ignore no-explicit-any
async function handleCuratedValidation(
  supabaseAdmin: any,
  openaiApiKey: string,
  opts: {
    revalidate: boolean;
    limit: number;
    dryRun: boolean;
    afterCreatedAt?: string;
    cardIds?: string[];
  }
): Promise<Response> {
  const { revalidate, limit, dryRun, afterCreatedAt, cardIds } = opts;

  // Fetch curated cards that need validation
  let cardQuery = supabaseAdmin
    .from("card_pool")
    .select("id, created_at, categories, original_categories, experience_type")
    .eq("is_active", true)
    .eq("card_type", "curated")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (!revalidate) {
    cardQuery = cardQuery.is("ai_approved", null);
  }
  if (cardIds && cardIds.length > 0) {
    cardQuery = cardQuery.in("id", cardIds);
  }
  if (afterCreatedAt) {
    cardQuery = cardQuery.lt("created_at", afterCreatedAt);
  }

  const { data: curatedCards, error: cardErr } = await cardQuery;
  if (cardErr) {
    return new Response(
      JSON.stringify({ error: `Fetch failed: ${cardErr.message}` }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  if (!curatedCards || curatedCards.length === 0) {
    return new Response(
      JSON.stringify({
        processed: 0, approved: 0, rejected: 0, failed: 0,
        categoriesChanged: 0, categoriesAdded: 0, categoriesRemoved: 0,
        rejectedExamples: [], recategorizedExamples: [], costUsd: 0,
        continuation_token: null,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Fetch all stops for these cards
  const cardIdList = curatedCards.map((c: any) => c.id);
  const { data: stopsRaw, error: stopsErr } = await supabaseAdmin
    .from("card_pool_stops")
    .select(`
      card_pool_id,
      stop_number,
      role,
      optional,
      place_pool!inner (
        name, primary_type, types, rating, review_count,
        price_level, website, address, editorial_summary, raw_google_data
      )
    `)
    .in("card_pool_id", cardIdList)
    .order("stop_number", { ascending: true });

  if (stopsErr) {
    return new Response(
      JSON.stringify({ error: `Stops fetch failed: ${stopsErr.message}` }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Group stops by card_pool_id
  const stopsByCard = new Map<string, any[]>();
  for (const stop of (stopsRaw || [])) {
    const list = stopsByCard.get(stop.card_pool_id) || [];
    list.push(stop);
    stopsByCard.set(stop.card_pool_id, list);
  }

  let approved = 0;
  let rejected = 0;
  let failed = 0;
  let lastProcessedCreatedAt: string | null = null;
  const rejectedExamples: Array<{ name: string; originalCategory: string; reason: string }> = [];

  for (const card of curatedCards) {
    const stops = stopsByCard.get(card.id) || [];
    if (stops.length === 0) {
      // No stops found — mark as rejected to prevent infinite retry
      if (!dryRun) {
        await supabaseAdmin
          .from("card_pool")
          .update({
            ai_approved: false,
            ai_reason: "No stops found in card_pool_stops — broken curated card",
            ai_validated_at: new Date().toISOString(),
          })
          .eq("id", card.id);
      }
      rejected++;
      rejectedExamples.push({
        name: `Curated: Card ${card.id.slice(0, 8)}`,
        originalCategory: (card.categories || []).join(", "),
        reason: "No stops found in card_pool_stops",
      });
      lastProcessedCreatedAt = card.created_at;
      continue;
    }

    const stopResults: string[] = [];
    let allRequiredPass = true;
    let cardFailed = false;

    for (const stop of stops) {
      const pp = stop.place_pool;
      if (!pp) continue;

      const stopRow: CardRow = {
        card_id: card.id,
        categories: card.categories || [],
        original_categories: card.original_categories,
        card_type: "curated",
        name: pp.name,
        primary_type: pp.primary_type,
        types: pp.types || [],
        rating: pp.rating,
        review_count: pp.review_count || 0,
        price_level: pp.price_level,
        website: pp.website,
        address: pp.address,
        editorial_summary: pp.editorial_summary,
        google_summary: pp.raw_google_data?.editorialSummary?.text ?? null,
      };

      let result: ValidationResult;
      try {
        const prompt = buildPrompt(stopRow);
        result = await callGPT(prompt, openaiApiKey);
      } catch (err) {
        console.error(`AI validation failed for curated card ${card.id} stop ${stop.stop_number}:`, err);
        stopResults.push(`Stop ${stop.stop_number} (${pp.name}): GPT failed — ${(err as Error).message}`);
        if (!stop.optional) {
          cardFailed = true;
          allRequiredPass = false;
        }
        failed++;
        continue;
      }

      // Check if this stop's role category is in fits_categories
      const roleCategory = stop.role || "";
      const stopFits = result.fits_categories.length > 0;
      const fitsRole = roleCategory ? result.fits_categories.includes(roleCategory) : stopFits;

      if (!fitsRole) {
        if (stop.optional) {
          stopResults.push(`Optional stop ${stop.stop_number} (${pp.name}): does not fit role "${roleCategory}" — ${result.reason}`);
        } else {
          allRequiredPass = false;
          stopResults.push(`Stop ${stop.stop_number} (${pp.name}): FAILED role "${roleCategory}" — ${result.reason}`);
        }
      } else {
        stopResults.push(`Stop ${stop.stop_number} (${pp.name}): OK [${result.fits_categories.join(", ")}]`);
      }
    }

    const cardApproved = allRequiredPass && !cardFailed;
    const aiReason = cardApproved
      ? "All required stops validated"
      : stopResults.filter((s) => s.includes("FAILED") || s.includes("failed")).join(" | ");

    if (cardApproved) {
      approved++;
    } else {
      rejected++;
      const firstName = stops[0]?.place_pool?.name || `Card ${card.id.slice(0, 8)}`;
      rejectedExamples.push({
        name: `Curated: ${firstName}...`,
        originalCategory: (card.categories || []).join(", "),
        reason: aiReason,
      });
    }

    if (!dryRun) {
      await supabaseAdmin
        .from("card_pool")
        .update({
          ai_approved: cardApproved,
          ai_reason: aiReason,
          ai_validated_at: new Date().toISOString(),
          // Do NOT change categories on curated cards
        })
        .eq("id", card.id);
    }

    lastProcessedCreatedAt = card.created_at;
    console.log(
      `Curated validated: ${card.id.slice(0, 8)} → ${cardApproved ? "approved" : "rejected"} (${stops.length} stops)`
    );
  }

  const processed = approved + rejected + failed;
  const costUsd = Math.round(processed * 0.02 * 100) / 100; // curated costs more (multiple stops)

  return new Response(
    JSON.stringify({
      processed,
      approved,
      rejected,
      failed,
      categoriesChanged: 0,
      categoriesAdded: 0,
      categoriesRemoved: 0,
      rejectedExamples: rejectedExamples.slice(0, 10),
      recategorizedExamples: [],
      costUsd,
      continuation_token: lastProcessedCreatedAt,
      dryRun,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
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

    // Create admin client (bypasses RLS)
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    // Verify caller is admin (service_role key in auth header, or admin JWT)
    const token = authHeader.replace("Bearer ", "");
    if (token !== serviceRoleKey) {
      // Check if it's a valid admin JWT
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
      // Check admin_users table
      const { data: adminUser } = await supabaseAdmin
        .from("admin_users")
        .select("id")
        .eq("user_id", user.id)
        .eq("is_active", true)
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
      cardType = "single",
      categorySlug,
      cardIds,
      revalidate = false,
      limit: rawLimit = 25,
      dryRun = false,
      afterCreatedAt,
    } = body;

    const limit = Math.min(Math.max(rawLimit, 1), 100);

    // ── Branch: curated card validation ─────────────────────────────────────
    if (cardType === "curated") {
      return await handleCuratedValidation(
        supabaseAdmin,
        openaiApiKey,
        { revalidate, limit, dryRun, afterCreatedAt, cardIds }
      );
    }

    // ── Step 1: Fetch single cards to validate ──────────────────────────────

    let query = supabaseAdmin
      .from("card_pool")
      .select(
        `
        id,
        created_at,
        categories,
        original_categories,
        card_type,
        place_pool!inner (
          name,
          primary_type,
          types,
          rating,
          review_count,
          price_level,
          website,
          address,
          editorial_summary,
          raw_google_data
        )
      `
      )
      .eq("is_active", true)
      .eq("card_type", "single")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (!revalidate) {
      query = query.is("ai_approved", null);
    }

    if (categorySlug) {
      query = query.contains("categories", [categorySlug]);
    }

    if (cardIds && cardIds.length > 0) {
      query = query.in("id", cardIds);
    }

    if (afterCreatedAt) {
      query = query.lt("created_at", afterCreatedAt);
    }

    const { data: cards, error: fetchError } = await query;

    if (fetchError) {
      return new Response(
        JSON.stringify({ error: `Fetch failed: ${fetchError.message}` }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!cards || cards.length === 0) {
      return new Response(
        JSON.stringify({
          processed: 0,
          approved: 0,
          rejected: 0,
          failed: 0,
          categoriesChanged: 0,
          categoriesAdded: 0,
          categoriesRemoved: 0,
          rejectedExamples: [],
          recategorizedExamples: [],
          costUsd: 0,
          continuation_token: null,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // ── Step 2 & 3: Validate each card sequentially ─────────────────────────

    let approved = 0;
    let rejected = 0;
    let failed = 0;
    let categoriesChanged = 0;
    let categoriesAdded = 0;
    let categoriesRemoved = 0;
    const rejectedExamples: Array<{
      name: string;
      originalCategory: string;
      reason: string;
    }> = [];
    const recategorizedExamples: Array<{
      name: string;
      from: string[];
      to: string[];
      reason: string;
    }> = [];
    let lastProcessedCreatedAt: string | null = null;

    for (const card of cards) {
      // deno-lint-ignore no-explicit-any
      const pp = (card as any).place_pool;
      if (!pp) continue;

      const cardRow: CardRow = {
        card_id: card.id,
        categories: card.categories || [],
        original_categories: card.original_categories,
        card_type: card.card_type,
        name: pp.name,
        primary_type: pp.primary_type,
        types: pp.types || [],
        rating: pp.rating,
        review_count: pp.review_count || 0,
        price_level: pp.price_level,
        website: pp.website,
        address: pp.address,
        editorial_summary: pp.editorial_summary,
        google_summary:
          pp.raw_google_data?.editorialSummary?.text ?? null,
      };

      let result: ValidationResult;
      try {
        const prompt = buildPrompt(cardRow);
        result = await callGPT(prompt, openaiApiKey);
      } catch (err) {
        console.error(
          `AI validation failed for card ${card.id} (${cardRow.name}):`,
          err
        );
        // Mark as failed but don't crash the batch
        failed++;
        if (!dryRun) {
          await supabaseAdmin
            .from("card_pool")
            .update({
              ai_reason: `AI validation failed: ${(err as Error).message}`,
              ai_validated_at: new Date().toISOString(),
            })
            .eq("id", card.id);
        }
        lastProcessedCreatedAt = (card as any).created_at;
        continue;
      }

      const originalCategories =
        card.original_categories && card.original_categories.length > 0
          ? card.original_categories
          : card.categories;

      const fitsAny = result.fits_categories.length > 0;
      const currentCats = card.categories || [];
      const newCats = result.fits_categories;

      // Track stats
      if (fitsAny) {
        approved++;
      } else {
        rejected++;
        rejectedExamples.push({
          name: cardRow.name,
          originalCategory: currentCats.join(", "),
          reason: result.reason,
        });
      }

      // Check if categories changed
      const catsEqual =
        currentCats.length === newCats.length &&
        currentCats.every((c: string) => newCats.includes(c));
      if (fitsAny && !catsEqual) {
        categoriesChanged++;
        // Count added/removed
        const added = newCats.filter(
          (c: string) => !currentCats.includes(c)
        ).length;
        const removed = currentCats.filter(
          (c: string) => !newCats.includes(c)
        ).length;
        categoriesAdded += added;
        categoriesRemoved += removed;
        recategorizedExamples.push({
          name: cardRow.name,
          from: currentCats,
          to: newCats,
          reason: result.reason,
        });
      }

      // ── Step 4: Update card_pool ──────────────────────────────────────────
      if (!dryRun) {
        await supabaseAdmin
          .from("card_pool")
          .update({
            ai_approved: fitsAny,
            ai_reason: result.reason,
            ai_categories: result.fits_categories,
            original_categories: originalCategories,
            ai_validated_at: new Date().toISOString(),
            categories: fitsAny ? result.fits_categories : card.categories,
          })
          .eq("id", card.id);
      }

      lastProcessedCreatedAt = (card as any).created_at;
      console.log(
        `Validated: ${cardRow.name} → ${fitsAny ? "approved" : "rejected"} [${result.fits_categories.join(", ")}]`
      );
    }

    // ── Step 5: Return summary ──────────────────────────────────────────────

    const processed = approved + rejected + failed;
    // Rough cost estimate: ~$0.005 per card (GPT-5.4-mini + web search)
    const costUsd = Math.round(processed * 0.005 * 100) / 100;

    return new Response(
      JSON.stringify({
        processed,
        approved,
        rejected,
        failed,
        categoriesChanged,
        categoriesAdded,
        categoriesRemoved,
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
    console.error("ai-validate-cards error:", error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

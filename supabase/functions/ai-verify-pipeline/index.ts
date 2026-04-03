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
  grooming: ["threading","waxing studio","lash extension","microblading","permanent makeup","nail salon","hair salon","barber","kosmetikstudio","institut de beauté","beauty parlour","tanning studio","brow bar","beauty salon"],
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

CATEGORIES (* = must have candidate_website):
flowers, *fine_dining, nature_views, first_meet, drink, casual_eats, *watch, *live_performance, *creative_arts, *play, *wellness, picnic_park, groceries

RULES:
- Determine what this place PRIMARILY IS first (restaurant, museum, bar, park, etc.)
- Only assign categories where the match is OBVIOUS. Default is zero categories.
- A museum with a cafe is creative_arts, NOT casual_eats.
- A park with a kiosk is nature_views+picnic_park, NOT drink.

FINE_DINING: Chef-led, upscale, anniversary-worthy, great ambience. Being a chain does NOT disqualify — quality is the only test. Olive Garden/Cheesecake Factory fail. Nobu/Morton's pass.
CASUAL_EATS: Real sit-down restaurants including chain restaurants. NO fast food/counter-service chains.
WELLNESS: Spas, saunas, hammams, massage, resorts, float tanks. NO salons, NO beauty parlours, NO nail/hair/waxing.
WATCH: Real cinemas with screens and scheduled movies. NO film production companies, NO festival offices.
PLAY: Active fun for adults. NO kids-only venues, NO gyms, NO gambling halls (exception: upscale casinos).
LIVE_PERFORMANCE: Stage + performers + audience. NO production companies, NO booking agencies, NO dance studios.
NATURE_VIEWS: Scenic outdoor spots. Parks also get picnic_park if they have grass for a blanket.
CREATIVE_ARTS: Museums, galleries, cultural centers. Aquarium → creative_arts + play.

REJECT if: kids-only, fast food chain, closed permanently, not a venue, personal grooming, fitness, gambling hall.

*categories need candidate_website to be non-null. If candidate_website is null for a *category, do not assign that category.

If has_opening_hours is false AND the place is NOT a park/trail/beach/outdoor venue, flag confidence as "medium" or lower.

Return ONLY valid JSON.`;

const CLASSIFICATION_SCHEMA = {
  type: "object",
  properties: {
    d: { type: "string", enum: ["accept", "reject"] },
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

async function classifyPlace(factSheet: Record<string, unknown>): Promise<ClassResult> {
  const openaiKey = Deno.env.get("OPENAI_API_KEY") ?? "";
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o",
      input: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: JSON.stringify(factSheet) },
      ],
      text: {
        format: { type: "json_schema", name: "place_classification", schema: CLASSIFICATION_SCHEMA, strict: true },
      },
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
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

    const decision = result.decision === "accept"
      ? (JSON.stringify(result.categories.sort()) !== JSON.stringify([...(place.ai_categories || [])].sort()) ? "reclassify" : "accept")
      : "reject";

    return {
      decision,
      categories: result.decision === "accept" ? result.categories : [],
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
      console.error(`Process failed for ${placeId}: ${(err as Error).message}`);
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

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── Admin Seed Map Strangers ────────────────────────────────────────────────
// Creates fake stranger profiles around real users so the Discover Map
// looks populated. Three actions:
//   1. seed                  — seed around a specific lat/lng
//   2. seed_around_all_users — seed around every real user with a map location
//   3. cleanup               — delete all seed profiles (CASCADE cleans related tables)

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ── Name Pool (50 international names) ──────────────────────────────────────

const FAKE_PEOPLE = [
  // Arabic
  { firstName: "Yasmin", displayName: "Yasmin" },
  { firstName: "Omar", displayName: "Omar" },
  { firstName: "Layla", displayName: "Layla" },
  { firstName: "Khalid", displayName: "Khalid" },
  // Japanese
  { firstName: "Haruki", displayName: "Haruki" },
  { firstName: "Sakura", displayName: "Sakura" },
  { firstName: "Kenji", displayName: "Kenji" },
  { firstName: "Aiko", displayName: "Aiko" },
  // Korean
  { firstName: "Jihye", displayName: "Jihye" },
  { firstName: "Minho", displayName: "Minho" },
  { firstName: "Soyeon", displayName: "Soyeon" },
  // Brazilian / Portuguese
  { firstName: "Matheus", displayName: "Matheus" },
  { firstName: "Camila", displayName: "Camila" },
  { firstName: "Thiago", displayName: "Thiago" },
  { firstName: "Isabela", displayName: "Isabela" },
  // Indian
  { firstName: "Priya", displayName: "Priya" },
  { firstName: "Arjun", displayName: "Arjun" },
  { firstName: "Ananya", displayName: "Ananya" },
  { firstName: "Rohan", displayName: "Rohan" },
  // Nigerian
  { firstName: "Chioma", displayName: "Chioma" },
  { firstName: "Emeka", displayName: "Emeka" },
  { firstName: "Adaeze", displayName: "Adaeze" },
  // Turkish
  { firstName: "Elif", displayName: "Elif" },
  { firstName: "Baris", displayName: "Barış" },
  { firstName: "Defne", displayName: "Defne" },
  // French
  { firstName: "Manon", displayName: "Manon" },
  { firstName: "Theo", displayName: "Théo" },
  { firstName: "Chloe", displayName: "Chloé" },
  // German
  { firstName: "Lena", displayName: "Lena" },
  { firstName: "Finn", displayName: "Finn" },
  // Russian
  { firstName: "Anastasia", displayName: "Anastasia" },
  { firstName: "Dmitri", displayName: "Dmitri" },
  // Spanish / Latin American
  { firstName: "Valentina", displayName: "Valentina" },
  { firstName: "Mateo", displayName: "Mateo" },
  { firstName: "Lucia", displayName: "Lucía" },
  { firstName: "Santiago", displayName: "Santiago" },
  // Thai
  { firstName: "Niran", displayName: "Niran" },
  { firstName: "Ploy", displayName: "Ploy" },
  // Ethiopian
  { firstName: "Abeni", displayName: "Abeni" },
  { firstName: "Tariku", displayName: "Tariku" },
  // Chinese
  { firstName: "Mei", displayName: "Mei" },
  { firstName: "Wei", displayName: "Wei" },
  { firstName: "Lianhua", displayName: "Lianhua" },
  // Scandinavian
  { firstName: "Astrid", displayName: "Astrid" },
  { firstName: "Soren", displayName: "Søren" },
  // Greek
  { firstName: "Eleni", displayName: "Eleni" },
  { firstName: "Nikos", displayName: "Nikos" },
  // Persian
  { firstName: "Parisa", displayName: "Parisa" },
  { firstName: "Dariush", displayName: "Dariush" },
  // Swahili
  { firstName: "Amani", displayName: "Amani" },
  { firstName: "Zuri", displayName: "Zuri" },
];

const ACTIVITY_STATUSES: (string | null)[] = [
  "Exploring coffee shops ☕",
  "Looking for dinner spots",
  "Weekend brunch hunt 🥞",
  "Finding hidden gems",
  "New in town — exploring!",
  "Craving something sweet",
  "On a food adventure",
  "Happy hour search 🍷",
  null,
  null,
  null,
];

// Current 12 category slugs (must match categoryUtils.ts)
const ALL_CATEGORIES = [
  "nature", "first_meet", "picnic_park", "drink", "casual_eats",
  "fine_dining", "watch", "live_performance", "creative_arts",
  "play", "wellness", "flowers",
];

const ALL_TIERS = ["chill", "comfy", "bougie", "lavish"];

// Current 6 intent slugs
const ALL_INTENTS = ["adventurous", "first-date", "romantic", "group-fun", "picnic-dates", "take-a-stroll"];

// ── Helpers ─────────────────────────────────────────────────────────────────

function shuffled<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function pickRandom<T>(arr: T[], min: number, max: number): T[] {
  const count = min + Math.floor(Math.random() * (max - min + 1));
  return shuffled(arr).slice(0, count);
}

// ── Seed Logic ──────────────────────────────────────────────────────────────

async function seedAroundPoint(
  adminClient: SupabaseClient,
  centerLat: number,
  centerLng: number,
  count: number,
  radiusKm: number
): Promise<number> {
  if (count <= 0) return 0;
  const selected = shuffled(FAKE_PEOPLE).slice(0, Math.min(count, FAKE_PEOPLE.length));
  let created = 0;

  for (const person of selected) {
    const id = crypto.randomUUID();

    // Random position within radius
    const angle = Math.random() * 2 * Math.PI;
    const distance = Math.random() * radiusKm;
    const latOffset = (distance / 111.32) * Math.cos(angle);
    const lngOffset =
      (distance / (111.32 * Math.cos((centerLat * Math.PI) / 180))) *
      Math.sin(angle);
    const approxLat = centerLat + latOffset;
    const approxLng = centerLng + lngOffset;

    // Random preferences
    const categories = pickRandom(ALL_CATEGORIES, 3, 7);
    const priceTiers = pickRandom(ALL_TIERS, 1, 3);
    const intents = pickRandom(ALL_INTENTS, 1, 2);

    // Random "last active" within past 2 hours
    const lastActive = new Date(
      Date.now() - Math.random() * 2 * 60 * 60 * 1000
    );

    // Random activity status (some null)
    const status =
      ACTIVITY_STATUSES[Math.floor(Math.random() * ACTIVITY_STATUSES.length)];
    const statusExpiry = status
      ? new Date(Date.now() + 4 * 60 * 60 * 1000)
      : null;

    // Single table insert — no auth.users dependency
    const { error } = await adminClient.from("seed_map_presence").insert({
      id,
      display_name: person.displayName,
      first_name: person.firstName,
      avatar_url: null,
      approximate_lat: approxLat,
      approximate_lng: approxLng,
      last_active_at: lastActive.toISOString(),
      activity_status: status,
      activity_status_expires_at: statusExpiry?.toISOString() || null,
      categories,
      price_tiers: priceTiers,
      intents,
    });
    if (error) {
      console.error(`[seed] insert failed for ${person.displayName}:`, error);
      continue;
    }

    created++;
  }

  return created;
}

// ── Cleanup ─────────────────────────────────────────────────────────────────

async function cleanup(adminClient: SupabaseClient) {
  // TRUNCATE via RPC — instant regardless of row count. See ORCH-0347B.
  const { data, error } = await adminClient.rpc("truncate_seed_map_presence");
  if (error) throw new Error(`Cleanup failed: ${error.message}`);
  return { deleted: (data as any)?.deleted ?? 0 };
}

// ── Seed Around All Users ───────────────────────────────────────────────────

async function seedAroundAllUsers(
  adminClient: SupabaseClient,
  count: number,
  radiusKm: number
) {
  // Get all real users with map locations
  const { data: allMapUsers, error: mapErr } = await adminClient
    .from("user_map_settings")
    .select("user_id, approximate_lat, approximate_lng")
    .not("approximate_lat", "is", null)
    .not("approximate_lng", "is", null);

  if (mapErr) throw new Error(`Failed to fetch map users: ${mapErr.message}`);

  // Filter out seed users
  const { data: seedProfiles } = await adminClient
    .from("profiles")
    .select("id")
    .eq("is_seed", true);
  const seedIdSet = new Set((seedProfiles || []).map((s: { id: string }) => s.id));
  const realUserLocations = (allMapUsers || []).filter(
    (u: { user_id: string }) => !seedIdSet.has(u.user_id)
  );

  if (realUserLocations.length === 0) {
    return { totalCreated: 0, realUsers: 0, message: "No real users with map locations found" };
  }

  // Clean up existing seed data first
  const { deleted } = await cleanup(adminClient);

  // Seed around each real user
  let totalCreated = 0;
  for (const loc of realUserLocations) {
    const created = await seedAroundPoint(
      adminClient,
      loc.approximate_lat,
      loc.approximate_lng,
      count,
      radiusKm
    );
    totalCreated += created;
  }

  return {
    totalCreated,
    realUsers: realUserLocations.length,
    previouslyDeleted: deleted,
  };
}

// ── Continental Bounding Boxes (simplified land filter) ─────────────────────

const LAND_BOXES = [
  { latMin: 15, latMax: 70, lngMin: -170, lngMax: -50 },   // North America
  { latMin: -56, latMax: 15, lngMin: -82, lngMax: -34 },   // South America
  { latMin: 35, latMax: 70, lngMin: -12, lngMax: 45 },     // Europe
  { latMin: -35, latMax: 37, lngMin: -18, lngMax: 52 },    // Africa
  { latMin: 10, latMax: 55, lngMin: 45, lngMax: 100 },     // Asia (west)
  { latMin: 20, latMax: 55, lngMin: 100, lngMax: 145 },    // Asia (east)
  { latMin: -10, latMax: 20, lngMin: 95, lngMax: 140 },    // Southeast Asia
  { latMin: -47, latMax: -10, lngMin: 112, lngMax: 180 },  // Australia + NZ
  { latMin: 6, latMax: 35, lngMin: 68, lngMax: 90 },       // India
  { latMin: 12, latMax: 42, lngMin: 25, lngMax: 65 },      // Middle East
  { latMin: 50, latMax: 60, lngMin: -11, lngMax: 2 },      // UK + Ireland
  { latMin: 63, latMax: 67, lngMin: -25, lngMax: -13 },    // Iceland
];

function isOnLand(lat: number, lng: number): boolean {
  return LAND_BOXES.some(b => lat >= b.latMin && lat <= b.latMax && lng >= b.lngMin && lng <= b.lngMax);
}

// ── Global Grid Seeding ────────────────────────────────────────────────────

async function seedGlobalGrid(
  adminClient: SupabaseClient,
  latMin: number,
  latMax: number,
): Promise<{ totalCreated: number; latBandsProcessed: number }> {
  const LAT_STEP = 0.09;  // ~10km
  let totalCreated = 0;
  let latBandsProcessed = 0;

  for (let lat = latMin; lat <= latMax; lat += LAT_STEP) {
    const lngStep = LAT_STEP / Math.max(Math.cos(lat * Math.PI / 180), 0.1);
    const batch: Array<{ id: string; person: typeof FAKE_PEOPLE[0]; lat: number; lng: number }> = [];

    for (let lng = -180; lng <= 180; lng += lngStep) {
      if (!isOnLand(lat, lng)) continue;
      const person = FAKE_PEOPLE[Math.floor(Math.random() * FAKE_PEOPLE.length)];
      batch.push({ id: crypto.randomUUID(), person, lat, lng });
    }

    // Insert batch in chunks of 500
    for (let i = 0; i < batch.length; i += 5000) {
      const chunk = batch.slice(i, i + 5000);

      // Single table insert — no auth.users dependency
      const rows = chunk.map(({ id, person, lat: cLat, lng: cLng }) => {
        const status = ACTIVITY_STATUSES[Math.floor(Math.random() * ACTIVITY_STATUSES.length)];
        return {
          id,
          display_name: person.displayName,
          first_name: person.firstName,
          avatar_url: null,
          approximate_lat: cLat + (Math.random() - 0.5) * 0.005,
          approximate_lng: cLng + (Math.random() - 0.5) * 0.005,
          last_active_at: new Date(Date.now() - Math.random() * 4 * 60 * 60 * 1000).toISOString(),
          activity_status: status,
          activity_status_expires_at: status ? new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString() : null,
          categories: pickRandom(ALL_CATEGORIES, 2, 4),
          price_tiers: pickRandom(ALL_TIERS, 1, 3),
          intents: pickRandom(ALL_INTENTS, 1, 2),
        };
      });

      const { error } = await adminClient.from("seed_map_presence").insert(rows);
      if (error) console.error(`[grid] batch error:`, error.message);

      totalCreated += chunk.length;
    }

    latBandsProcessed++;
    if (latBandsProcessed % 10 === 0) {
      console.log(`[grid] Progress: ${latBandsProcessed} lat bands, ${totalCreated} strangers created`);
    }
  }

  return { totalCreated, latBandsProcessed };
}

// ── Main Handler ────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Verify auth
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return json({ error: "No authorization header" }, 401);
    }

    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user },
      error: authError,
    } = await adminClient.auth.getUser(token);

    if (authError || !user) {
      return json({ error: "Unauthorized" }, 401);
    }

    // Admin check
    const { data: adminRow } = await adminClient
      .from("admin_users")
      .select("id")
      .eq("email", user.email)
      .eq("status", "active")
      .maybeSingle();

    if (!adminRow) {
      return json({ error: "Forbidden: admin access required" }, 403);
    }

    const body = await req.json();

    switch (body.action) {
      case "seed": {
        const { centerLat, centerLng, count = 15, radiusKm = 5 } = body;
        if (centerLat == null || centerLng == null) {
          return json({ error: "centerLat and centerLng are required" }, 400);
        }
        const created = await seedAroundPoint(
          adminClient,
          centerLat,
          centerLng,
          count,
          radiusKm
        );
        return json({ action: "seed", created, centerLat, centerLng });
      }

      case "seed_around_all_users": {
        const { count = 15, radiusKm = 5 } = body;
        const result = await seedAroundAllUsers(adminClient, count, radiusKm);
        return json({ action: "seed_around_all_users", ...result });
      }

      case "seed_global_grid": {
        const { latMin = -60, latMax = 70 } = body.latRange || {};
        const skipCleanup = body.skipCleanup === true;
        let deleted = 0;
        if (!skipCleanup) {
          const cleanupResult = await cleanup(adminClient);
          deleted = cleanupResult.deleted;
        }
        const result = await seedGlobalGrid(adminClient, latMin, latMax);
        return json({ action: "seed_global_grid", previouslyDeleted: deleted, skippedCleanup: skipCleanup, ...result });
      }

      case "seed_cities": {
        // Cleanup existing seeds first
        const { deleted } = await cleanup(adminClient);

        // Get cities that are seeded or launched
        const { data: cities, error: citiesErr } = await adminClient
          .from("seeding_cities")
          .select("id, name, country, center_lat, center_lng, coverage_radius_km")
          .in("status", ["seeded", "launched"]);

        if (citiesErr) throw new Error(`Failed to fetch cities: ${citiesErr.message}`);
        if (!cities || cities.length === 0) {
          return json({ action: "seed_cities", error: "No seeded/launched cities found" }, 400);
        }

        // Get place count per city via RPC — density scales with pool size. See ORCH-0347B.
        const { data: countData, error: countErr } = await adminClient.rpc("get_place_count_per_city");
        const cityPlaceCounts: Record<string, number> = {};
        if (!countErr && countData) {
          for (const row of countData as { city_id: string; place_count: number }[]) {
            cityPlaceCounts[row.city_id] = Number(row.place_count);
          }
        }

        // Generate strangers per city — only cities with places in pool
        const allRows: any[] = [];
        let citiesSeeded = 0;

        for (const city of cities) {
          const placeCount = cityPlaceCounts[city.id] || 0;
          if (placeCount === 0) continue; // Skip cities with no places

          // Density: 3-10 strangers per city, ~1 per 10 places
          const strangerCount = Math.max(3, Math.min(10, Math.ceil(placeCount / 10)));
          const radiusKm = city.coverage_radius_km || 10;

          for (let j = 0; j < strangerCount; j++) {
            const person = FAKE_PEOPLE[Math.floor(Math.random() * FAKE_PEOPLE.length)];
            const id = crypto.randomUUID();
            const angle = Math.random() * 2 * Math.PI;
            const dist = Math.random() * radiusKm;
            const latOff = (dist / 111.32) * Math.cos(angle);
            const lngOff = (dist / (111.32 * Math.cos((city.center_lat * Math.PI) / 180))) * Math.sin(angle);

            const status = ACTIVITY_STATUSES[Math.floor(Math.random() * ACTIVITY_STATUSES.length)];
            allRows.push({
              id,
              city_id: city.id,
              display_name: person.displayName,
              first_name: person.firstName,
              avatar_url: null,
              approximate_lat: city.center_lat + latOff,
              approximate_lng: city.center_lng + lngOff,
              last_active_at: new Date(Date.now() - Math.random() * 4 * 60 * 60 * 1000).toISOString(),
              activity_status: status,
              activity_status_expires_at: status ? new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString() : null,
              categories: pickRandom(ALL_CATEGORIES, 2, 4),
              price_tiers: pickRandom(ALL_TIERS, 1, 3),
              intents: pickRandom(ALL_INTENTS, 1, 2),
            });
          }
          citiesSeeded++;
        }

        // Batch insert in chunks of 5000
        let totalCreated = 0;
        for (let i = 0; i < allRows.length; i += 5000) {
          const chunk = allRows.slice(i, i + 5000);
          const { error } = await adminClient.from("seed_map_presence").insert(chunk);
          if (error) {
            console.error(`[seed_cities] batch error:`, error.message);
          } else {
            totalCreated += chunk.length;
          }
        }

        return json({
          action: "seed_cities",
          citiesTotal: cities.length,
          citiesWithPlaces: citiesSeeded,
          totalCreated,
          previouslyDeleted: deleted,
        });
      }

      case "get_seed_stats": {
        const { data: cities, error: statsErr } = await adminClient.rpc("get_seed_stats_per_city");
        if (statsErr) throw new Error(`Stats failed: ${statsErr.message}`);

        const { count: globalCount } = await adminClient
          .from("seed_map_presence")
          .select("*", { count: "exact", head: true })
          .is("city_id", null);

        return json({
          action: "get_seed_stats",
          cities: cities || [],
          totalSeeds: (cities || []).reduce((sum: number, c: any) => sum + Number(c.seed_count), 0) + (globalCount || 0),
          globalSeeds: globalCount || 0,
        });
      }

      case "seed_single_city": {
        const { cityId, count: seedCount = 10 } = body;
        if (!cityId) return json({ error: "cityId is required" }, 400);

        const { data: city, error: cityErr } = await adminClient
          .from("seeding_cities")
          .select("id, name, country, center_lat, center_lng, coverage_radius_km")
          .eq("id", cityId)
          .single();
        if (cityErr || !city) return json({ error: "City not found" }, 404);

        const { count: prevCount } = await adminClient
          .from("seed_map_presence")
          .select("*", { count: "exact", head: true })
          .eq("city_id", cityId);
        await adminClient.from("seed_map_presence").delete().eq("city_id", cityId);

        const radiusKm = city.coverage_radius_km || 10;
        const rows: any[] = [];
        for (let j = 0; j < seedCount; j++) {
          const person = FAKE_PEOPLE[Math.floor(Math.random() * FAKE_PEOPLE.length)];
          const id = crypto.randomUUID();
          const angle = Math.random() * 2 * Math.PI;
          const dist = Math.random() * radiusKm;
          const latOff = (dist / 111.32) * Math.cos(angle);
          const lngOff = (dist / (111.32 * Math.cos((city.center_lat * Math.PI) / 180))) * Math.sin(angle);
          const status = ACTIVITY_STATUSES[Math.floor(Math.random() * ACTIVITY_STATUSES.length)];

          rows.push({
            id,
            city_id: cityId,
            display_name: person.displayName,
            first_name: person.firstName,
            avatar_url: null,
            approximate_lat: city.center_lat + latOff,
            approximate_lng: city.center_lng + lngOff,
            last_active_at: new Date(Date.now() - Math.random() * 4 * 60 * 60 * 1000).toISOString(),
            activity_status: status,
            activity_status_expires_at: status ? new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString() : null,
            categories: pickRandom(ALL_CATEGORIES, 2, 4),
            price_tiers: pickRandom(ALL_TIERS, 1, 3),
            intents: pickRandom(ALL_INTENTS, 1, 2),
          });
        }

        const { error: insertErr } = await adminClient.from("seed_map_presence").insert(rows);
        if (insertErr) throw new Error(`Insert failed: ${insertErr.message}`);

        return json({
          action: "seed_single_city",
          cityId,
          cityName: city.name,
          created: rows.length,
          previouslyClearedForCity: prevCount || 0,
        });
      }

      case "clear_single_city": {
        const { cityId } = body;
        if (!cityId) return json({ error: "cityId is required" }, 400);

        const { count } = await adminClient
          .from("seed_map_presence")
          .select("*", { count: "exact", head: true })
          .eq("city_id", cityId);
        await adminClient.from("seed_map_presence").delete().eq("city_id", cityId);

        return json({
          action: "clear_single_city",
          cityId,
          deleted: count || 0,
        });
      }

      case "cleanup": {
        const result = await cleanup(adminClient);
        return json({ action: "cleanup", ...result });
      }

      default:
        return json(
          {
            error: `Unknown action: ${body.action}. Valid: seed, seed_around_all_users, seed_global_grid, seed_cities, seed_single_city, clear_single_city, get_seed_stats, cleanup`,
          },
          400
        );
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[admin-seed-map-strangers] Error:", msg);
    return json({ error: msg }, 500);
  }
});

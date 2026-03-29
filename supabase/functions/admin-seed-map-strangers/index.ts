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

const ALL_CATEGORIES = [
  "Nature & Views",
  "First Meet",
  "Picnic Park",
  "Drink",
  "Casual Eats",
  "Fine Dining",
  "Live & Loud",
  "Culture",
  "Active",
  "Sweet Tooth",
  "Shop & Browse",
  "Nightlife",
  "Spa & Relax",
];

const ALL_TIERS = ["chill", "comfy", "bougie", "lavish"];
const ALL_INTENTS = ["adventurous", "romantic", "friendly", "group-fun"];

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

    // INSERT profile
    const { error: profileErr } = await adminClient.from("profiles").insert({
      id,
      display_name: person.displayName,
      first_name: person.firstName,
      avatar_url: null,
      has_completed_onboarding: true,
      is_seed: true,
    });
    if (profileErr) {
      console.error(`[seed] profile insert failed for ${person.displayName}:`, profileErr);
      continue;
    }

    // INSERT user_map_settings
    const { error: mapErr } = await adminClient
      .from("user_map_settings")
      .insert({
        user_id: id,
        visibility_level: "everyone",
        approximate_lat: approxLat,
        approximate_lng: approxLng,
        real_lat: approxLat,
        real_lng: approxLng,
        last_active_at: lastActive.toISOString(),
        activity_status: status,
        activity_status_expires_at: statusExpiry?.toISOString() || null,
      });
    if (mapErr) {
      console.error(`[seed] map_settings insert failed for ${person.displayName}:`, mapErr);
      // Clean up orphaned profile
      await adminClient.from("profiles").delete().eq("id", id);
      continue;
    }

    // INSERT preferences
    const { error: prefErr } = await adminClient.from("preferences").insert({
      profile_id: id,
      categories,
      price_tiers: priceTiers,
      intents,
    });
    if (prefErr) {
      console.error(`[seed] preferences insert failed for ${person.displayName}:`, prefErr);
      // Clean up — CASCADE from profiles will handle map_settings
      await adminClient.from("profiles").delete().eq("id", id);
      continue;
    }

    created++;
  }

  return created;
}

// ── Cleanup ─────────────────────────────────────────────────────────────────

async function cleanup(adminClient: SupabaseClient) {
  const { data, error } = await adminClient
    .from("profiles")
    .delete()
    .eq("is_seed", true)
    .select("id");

  if (error) {
    throw new Error(`Cleanup failed: ${error.message}`);
  }

  // CASCADE handles user_map_settings, preferences, friend_requests, etc.
  return { deleted: data?.length || 0 };
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

      case "cleanup": {
        const result = await cleanup(adminClient);
        return json({ action: "cleanup", ...result });
      }

      default:
        return json(
          {
            error: `Unknown action: ${body.action}. Valid: seed, seed_around_all_users, cleanup`,
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

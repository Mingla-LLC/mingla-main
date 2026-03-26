import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization")!;
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { lat, lng, radiusKm = 15 } = await req.json();
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // Bidirectional visibility: fetch requester's own visibility level.
    // You must be visible to see strangers — no lurking.
    const { data: requesterSettings } = await adminClient
      .from("user_map_settings")
      .select("visibility_level")
      .eq("user_id", user.id)
      .maybeSingle();
    const requesterVisibility = requesterSettings?.visibility_level || "off";

    // Get requester's friends + paired people
    const [friendsResult, pairingsResult] = await Promise.all([
      adminClient.from("friends")
        .select("friend_user_id")
        .eq("user_id", user.id)
        .eq("status", "accepted"),
      adminClient.from("pairings")
        .select("user_a_id, user_b_id")
        .or(`user_a_id.eq.${user.id},user_b_id.eq.${user.id}`),
    ]);

    const friendIds = new Set((friendsResult.data || []).map((f: any) => f.friend_user_id));
    const pairedIds = new Set((pairingsResult.data || []).flatMap((p: any) =>
      [p.user_a_id, p.user_b_id].filter((id: string) => id !== user.id)
    ));

    // Get blocked users (bidirectional)
    const { data: blocks } = await adminClient
      .from("blocked_users")
      .select("blocked_user_id, blocker_id")
      .or(`blocker_id.eq.${user.id},blocked_user_id.eq.${user.id}`);
    const blockedIds = new Set((blocks || []).flatMap((b: any) => [b.blocked_user_id, b.blocker_id]));
    blockedIds.delete(user.id);

    // Bounding box query
    const latDelta = radiusKm / 111.32;
    const lngDelta = radiusKm / (111.32 * Math.cos(lat * Math.PI / 180));

    const { data: nearbySettings } = await adminClient
      .from("user_map_settings")
      .select("user_id, visibility_level, approximate_lat, approximate_lng, activity_status, activity_status_expires_at, last_active_at, go_dark_until")
      .neq("user_id", user.id)
      .neq("visibility_level", "off")
      .gte("approximate_lat", lat - latDelta)
      .lte("approximate_lat", lat + latDelta)
      .gte("approximate_lng", lng - lngDelta)
      .lte("approximate_lng", lng + lngDelta);

    if (!nearbySettings || nearbySettings.length === 0) {
      return new Response(JSON.stringify([]), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Filter by visibility + relationship + go_dark + blocks
    const now = new Date();
    const visibleUserIds: string[] = [];
    const relationshipMap = new Map<string, "paired" | "friend" | "stranger">();

    for (const s of nearbySettings) {
      if (s.go_dark_until && new Date(s.go_dark_until) > now) continue;
      if (blockedIds.has(s.user_id)) continue;
      const isPaired = pairedIds.has(s.user_id);
      const isFriend = friendIds.has(s.user_id);
      if (s.visibility_level === "paired" && !isPaired) continue;
      if (s.visibility_level === "friends" && !isFriend && !isPaired) continue;

      // Bidirectional: strangers can only see each other if BOTH are set to 'everyone'
      const isStranger = !isPaired && !isFriend;
      if (isStranger && requesterVisibility !== "everyone") continue;

      visibleUserIds.push(s.user_id);
      relationshipMap.set(s.user_id, isPaired ? "paired" : isFriend ? "friend" : "stranger");
    }

    if (visibleUserIds.length === 0) {
      return new Response(JSON.stringify([]), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch profiles
    const { data: profiles } = await adminClient
      .from("profiles")
      .select("id, display_name, first_name, last_name, avatar_url")
      .in("id", visibleUserIds);

    const profileMap = new Map((profiles || []).map((p: any) => [p.id, p]));

    // Taste match lookup for strangers
    const strangerIds = visibleUserIds.filter(id => relationshipMap.get(id) === "stranger");
    const tasteMatchMap = new Map<string, { matchPercentage: number; sharedCategories: string[]; sharedTiers: string[] }>();

    if (strangerIds.length > 0) {
      const canonicalPairs = strangerIds.map(id => {
        const [a, b] = [user.id, id].sort();
        return { a, b, originalId: id };
      });

      const { data: cachedMatches } = await adminClient
        .from("user_taste_matches")
        .select("user_a_id, user_b_id, match_percentage, shared_categories, shared_tiers, computed_at")
        .or(canonicalPairs.map(p => `and(user_a_id.eq.${p.a},user_b_id.eq.${p.b})`).join(","));

      const staleThreshold = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const freshMatches = new Map<string, any>();
      const staleOrMissingIds: string[] = [];

      for (const pair of canonicalPairs) {
        const cached = (cachedMatches || []).find(
          (m: any) => m.user_a_id === pair.a && m.user_b_id === pair.b
        );
        if (cached && new Date(cached.computed_at) > staleThreshold) {
          freshMatches.set(pair.originalId, cached);
        } else {
          staleOrMissingIds.push(pair.originalId);
        }
      }

      // Compute stale/missing matches (max 10 per request)
      for (const strangerId of staleOrMissingIds.slice(0, 10)) {
        try {
          const [a, b] = [user.id, strangerId].sort();
          const { data: matchResult } = await adminClient.rpc("compute_taste_match", {
            p_user_a: a, p_user_b: b,
          });
          if (matchResult && matchResult.length > 0) {
            const m = matchResult[0];
            await adminClient.from("user_taste_matches").upsert({
              user_a_id: a, user_b_id: b,
              match_percentage: m.match_percentage,
              shared_categories: m.shared_categories,
              shared_tiers: m.shared_tiers,
              shared_intents: m.shared_intents,
              computed_at: new Date().toISOString(),
            }, { onConflict: "user_a_id,user_b_id" });
            freshMatches.set(strangerId, m);
          }
        } catch (e) {
          console.warn(`[get-nearby-people] taste match compute failed for ${strangerId}:`, e);
        }
      }

      for (const [id, match] of freshMatches) {
        tasteMatchMap.set(id, {
          matchPercentage: match.match_percentage,
          sharedCategories: match.shared_categories || [],
          sharedTiers: match.shared_tiers || [],
        });
      }
    }

    // Rate limit check for map friend requests
    let mapFriendRequestsToday = 0;
    if (strangerIds.length > 0) {
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { count } = await adminClient
        .from("friend_requests")
        .select("*", { count: "exact", head: true })
        .eq("sender_id", user.id)
        .eq("source", "map")
        .gte("created_at", twentyFourHoursAgo);
      mapFriendRequestsToday = count || 0;
    }

    // Build response (NEVER include real_lat/lng)
    const result = nearbySettings
      .filter((s: any) => visibleUserIds.includes(s.user_id))
      .map((s: any) => {
        const profile = profileMap.get(s.user_id);
        const status = s.activity_status_expires_at && new Date(s.activity_status_expires_at) < now
          ? null : s.activity_status;
        const relationship = relationshipMap.get(s.user_id) || "stranger";
        const tasteMatch = tasteMatchMap.get(s.user_id);

        return {
          userId: s.user_id,
          displayName: profile?.display_name || profile?.first_name || "Someone",
          firstName: profile?.first_name || null,
          avatarUrl: profile?.avatar_url || null,
          approximateLat: s.approximate_lat,
          approximateLng: s.approximate_lng,
          activityStatus: status,
          lastActiveAt: s.last_active_at,
          relationship,
          tasteMatchPct: tasteMatch?.matchPercentage ?? null,
          sharedCategories: tasteMatch?.sharedCategories ?? [],
          sharedTiers: tasteMatch?.sharedTiers ?? [],
          canSendFriendRequest: relationship === "stranger" && mapFriendRequestsToday < 10,
          mapFriendRequestsRemaining: Math.max(0, 10 - mapFriendRequestsToday),
        };
      });

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buildPersonHeroCardsForSection,
  recordPersonCardImpressions,
  resolveFriendLocation,
  type PersonHeroSectionRequest,
} from "../_shared/personHeroCards.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RequestBody extends PersonHeroSectionRequest {
  personId?: string;
  pairedUserId?: string;
  viewerUserId?: string;
  location?: { latitude: number; longitude: number };
  mode?: "default" | "shuffle" | "bilateral" | "individual";
  excludeCardIds?: string[];
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const rawBody = await req.json();
    if (rawBody.warmPing) {
      return new Response(JSON.stringify({ status: "warm" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 401,
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 401,
      });
    }

    const body = rawBody as RequestBody;
    const effectivePersonId = body.pairedUserId ?? body.personId;
    const usingPairedUser = !!body.pairedUserId;
    if (!effectivePersonId || !UUID_RE.test(effectivePersonId)) {
      return new Response(JSON.stringify({ error: "personId or pairedUserId is required" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }
    if (!body.holidayKey || typeof body.holidayKey !== "string") {
      return new Response(JSON.stringify({ error: "holidayKey is required" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }
    if (!Array.isArray(body.categorySlugs) || body.categorySlugs.length === 0) {
      return new Response(JSON.stringify({ error: "categorySlugs is required" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    const adminClient = createClient(supabaseUrl, supabaseServiceKey);
    let location: { latitude: number; longitude: number };

    if (usingPairedUser && body.pairedUserId) {
      const friendLocation = await resolveFriendLocation(adminClient, user.id, body.pairedUserId);
      if (!friendLocation) {
        return new Response(
          JSON.stringify({
            cards: [],
            hasMore: false,
            locationStatus: "missing",
            summary: { emptyReason: "friend_gps_missing" },
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
        );
      }
      location = { latitude: friendLocation.lat, longitude: friendLocation.lng };
    } else {
      if (
        !body.location ||
        typeof body.location.latitude !== "number" ||
        typeof body.location.longitude !== "number"
      ) {
        return new Response(JSON.stringify({ error: "location is required" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        });
      }
      location = body.location;
    }

    const result = await buildPersonHeroCardsForSection({
      adminClient,
      authHeader,
      supabaseUrl,
      viewerId: user.id,
      pairedUserId: effectivePersonId,
      viewerUserId: body.viewerUserId,
      section: {
        holidayKey: body.holidayKey,
        categorySlugs: body.categorySlugs,
        curatedExperienceType: body.curatedExperienceType,
        isCustomHoliday: body.isCustomHoliday,
        yearsElapsed: body.yearsElapsed,
      },
      location,
      mode: body.mode,
      excludeCardIds: body.excludeCardIds,
    });

    if (usingPairedUser) {
      recordPersonCardImpressions({
        adminClient,
        viewerId: user.id,
        pairedUserId: effectivePersonId,
        holidayKey: body.holidayKey,
        cards: result.cards,
      });
    }

    return new Response(JSON.stringify({ ...result, locationStatus: "ok" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    console.error("[get-person-hero-cards] Unhandled error:", error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});

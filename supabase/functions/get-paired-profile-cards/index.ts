import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buildPersonHeroCardsForSection,
  recordPersonCardImpressions,
  resolveFriendLocation,
  resolveHolidayCategorySlugs,
  type Card,
  type PersonHeroSectionRequest,
} from "../_shared/personHeroCards.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RequestBody {
  pairedUserId: string;
  sections: PersonHeroSectionRequest[];
  mode?: "default" | "individual" | "bilateral";
}

function sortSectionWeight(section: PersonHeroSectionRequest): number {
  if (section.holidayKey === "birthday") return 0;
  if (section.holidayKey.startsWith("custom_")) return 1;
  return 2;
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
    if (!body.pairedUserId || !UUID_RE.test(body.pairedUserId)) {
      return new Response(JSON.stringify({ error: "pairedUserId is required" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }
    if (!Array.isArray(body.sections)) {
      return new Response(JSON.stringify({ error: "sections is required" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    const sanitizedSections = body.sections
      .filter((section) =>
        section &&
        typeof section.holidayKey === "string"
      )
      .map((section) => {
        const normalized: PersonHeroSectionRequest = {
          holidayKey: section.holidayKey,
          isCustomHoliday: !!section.isCustomHoliday,
          yearsElapsed: section.yearsElapsed,
          categorySlugs: Array.isArray(section.categorySlugs) ? section.categorySlugs : [],
          curatedExperienceType: section.curatedExperienceType ?? null,
        };
        return {
          ...normalized,
          categorySlugs: resolveHolidayCategorySlugs(normalized),
        };
      })
      .filter((section) => section.categorySlugs.length > 0);
    if (sanitizedSections.length === 0) {
      return new Response(JSON.stringify({ locationStatus: "ok", sections: {} }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    const adminClient = createClient(supabaseUrl, supabaseServiceKey);
    const friendLocation = await resolveFriendLocation(adminClient, user.id, body.pairedUserId);
    if (!friendLocation) {
      return new Response(JSON.stringify({ locationStatus: "missing", sections: {} }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    const orderedSections = [...sanitizedSections].sort((a, b) => {
      const weightDelta = sortSectionWeight(a) - sortSectionWeight(b);
      return weightDelta !== 0 ? weightDelta : 0;
    });
    const location = { latitude: friendLocation.lat, longitude: friendLocation.lng };

    const settled = await Promise.all(
      orderedSections.map(async (section) => {
        try {
          const result = await buildPersonHeroCardsForSection({
            adminClient,
            authHeader,
            supabaseUrl,
            viewerId: user.id,
            pairedUserId: body.pairedUserId,
            section,
            location,
            mode: body.mode ?? "default",
          });
          return { section, result };
        } catch (error) {
          console.warn("[get-paired-profile-cards] section failed:", section.holidayKey, error);
          return {
            section,
            result: {
              cards: [] as Card[],
              hasMore: false,
              summary: { emptyReason: "section_error" },
            },
          };
        }
      }),
    );

    const seen = new Set<string>();
    const sections: Record<string, { cards: Card[]; summary?: { emptyReason: string } }> = {};
    for (const entry of settled) {
      const cards = entry.result.cards.filter((card) => {
        if (card.cardType !== "single") return true;
        if (seen.has(card.id)) return false;
        seen.add(card.id);
        return true;
      });
      sections[entry.section.holidayKey] = {
        cards,
        ...(cards.length === 0
          ? { summary: entry.result.summary ?? { emptyReason: "no_viable_results" } }
          : entry.result.summary
            ? { summary: entry.result.summary }
            : {}),
      };
      recordPersonCardImpressions({
        adminClient,
        viewerId: user.id,
        pairedUserId: body.pairedUserId,
        holidayKey: entry.section.holidayKey,
        cards,
      });
    }

    return new Response(JSON.stringify({ locationStatus: "ok", sections }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    console.error("[get-paired-profile-cards] Unhandled error:", error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
